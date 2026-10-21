import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailMailboxSettings } from "@/lib/email-account-types";

const m = vi.hoisted(() => ({
  guardTenantApi: vi.fn(),
  getMailboxProfileServer: vi.fn(),
  isSuppressed: vi.fn(),
  sendOutboundMailServer: vi.fn(),
  recordEmailEvent: vi.fn(async () => ({ ok: true, id: "e1" })),
}));

vi.mock("@/lib/platform/tenant-api-guard", () => ({ guardTenantApi: m.guardTenantApi }));
vi.mock("@/lib/email/mailbox-profiles-server", () => ({
  getMailboxProfileServer: m.getMailboxProfileServer,
}));
vi.mock("@/lib/email/suppression-server", () => ({ isSuppressed: m.isSuppressed }));
vi.mock("@/lib/email/email-events-server", () => ({ recordEmailEvent: m.recordEmailEvent }));
vi.mock("@/lib/email/send-outbound-mail-server", () => ({
  sendOutboundMailServer: m.sendOutboundMailServer,
}));
vi.mock("@/lib/email/mailbox-data-owner-server", () => ({
  resolveMailboxDataOwnerUid: vi.fn(async () => ({ ok: true, dataOwnerUid: "u-1", access: "owner" })),
  canMailboxSend: () => true,
}));
vi.mock("@/lib/email/mailbox-send-quota-server", () => ({
  reserveMailboxDailySendServer: vi.fn(async () => ({ ok: true })),
  releaseMailboxDailySendServer: vi.fn(async () => undefined),
}));
vi.mock("@/lib/email/lead-contact-policy-server", () => ({
  assertLeadContactAllowedServer: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/email/persist-outbound-lead-mail-server", () => ({
  persistOutboundLeadMailServer: vi.fn(),
}));
vi.mock("@/lib/email/record-email-send-event-server", () => ({
  recordEmailSendEventServer: vi.fn(),
}));
vi.mock("@/lib/email/resolve-pending-reply-action-on-outbound-server", () => ({
  resolvePendingReplyActionOnOutboundServer: vi.fn(),
}));

import { POST } from "./route";

function profile(over: Partial<EmailMailboxSettings> = {}): EmailMailboxSettings {
  return {
    id: "mb-1", label: "Main", enabled: true, displayName: "Rep", emailAddress: "rep@nova.test",
    replyTo: "", signature: "", syncIntervalMinutes: 15, archiveOnSend: false,
    readReceipts: false, trackClicks: false, connectionType: "custom", dailySendLimit: null,
    assignedUserIds: [],
    smtp: { host: "smtp.saved.test", port: 465, secure: true, user: "vault-user", password: "vault-pass" },
    imap: { host: "", port: 993, secure: true, user: "", password: "" },
    ...over,
  };
}

function send(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/email/send", { method: "POST", body: JSON.stringify(body) }),
  );
}

const base = {
  mailboxId: "mb-1",
  from: "rep@nova.test",
  to: "client@nova.test",
  subject: "Hi",
  text: "Hello",
};

describe("/api/email/send send-time safety (QA 1.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.guardTenantApi.mockResolvedValue({
      ok: true,
      ctx: { session: { uid: "u-1", organizationId: "org-1", email: "rep@nova.test" }, role: "member" },
    });
    m.getMailboxProfileServer.mockResolvedValue(profile());
    m.isSuppressed.mockResolvedValue(false);
    m.sendOutboundMailServer.mockResolvedValue({ ok: true, messageId: "<m@1>", sentSavedToMailbox: false });
  });

  it("sends with the saved mailbox server, ignoring host/port from the request (SEND-01)", async () => {
    const res = await send({
      ...base,
      smtp: { host: "attacker.example", port: 2525, secure: false, user: "x", pass: "y" },
    });
    expect(res.status).toBe(200);
    const smtp = m.sendOutboundMailServer.mock.calls[0]![0].smtp;
    expect(smtp).toEqual({
      host: "smtp.saved.test", port: 465, secure: true, user: "vault-user", pass: "vault-pass",
    });
  });

  it("records an email_events sent row for a direct send (QA 2.6 / SEND-01)", async () => {
    const res = await send({ ...base, leadId: "l-1" });
    expect(res.status).toBe(200);
    expect(m.recordEmailEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "sent", leadId: "l-1", mailboxId: "mb-1", recipient: "client@nova.test" }),
    );
  });

  it("refuses a disabled mailbox (MBX-06)", async () => {
    m.getMailboxProfileServer.mockResolvedValue(profile({ enabled: false }));
    const res = await send(base);
    expect(res.status).toBe(409);
    expect(m.sendOutboundMailServer).not.toHaveBeenCalled();
  });

  it("refuses a suppressed recipient in to, cc or bcc (SEND-08)", async () => {
    m.isSuppressed.mockImplementation(async ({ email }: { email: string }) => email === "gone@nova.test");
    const res = await send({ ...base, cc: "Ok <ok@nova.test>, Gone <gone@nova.test>" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("recipient_suppressed");
    expect(m.sendOutboundMailServer).not.toHaveBeenCalled();
  });

  it("rejects a body without a mailbox with 400 (QA 2.8 / ROB-06)", async () => {
    const res = await send({ to: "x@nova.test", subject: "garbage" });
    expect(res.status).toBe(400);
    expect(m.sendOutboundMailServer).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown mailbox id instead of sending", async () => {
    m.getMailboxProfileServer.mockResolvedValue(null);
    const res = await send(base);
    expect(res.status).toBe(404);
    expect(m.sendOutboundMailServer).not.toHaveBeenCalled();
  });
});
