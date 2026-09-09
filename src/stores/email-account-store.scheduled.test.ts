import { describe, expect, it, beforeEach } from "vitest";
import { useEmailAccountStore } from "@/stores/email-account-store";
import type { ScheduledEmail } from "@/lib/email-account-types";

function pendingRow(overrides: Partial<ScheduledEmail> = {}): ScheduledEmail {
  const past = new Date(Date.now() - 5_000).toISOString();
  return {
    id: "sch-local-test",
    mailboxId: "mb-demo",
    from: "sender@nova.local",
    to: "recipient@example.com",
    subject: "Local scheduled send test",
    body: "Hello from vitest",
    text: "Hello from vitest",
    scheduledAt: past,
    status: "pending",
    createdAt: past,
    ...overrides,
  };
}

describe("processDueScheduledLocal (demo inbox sender)", () => {
  beforeEach(() => {
    useEmailAccountStore.setState({ scheduled: [], sent: [] });
  });

  it("moves due pending rows to sent and appends to sent mail", () => {
    useEmailAccountStore.setState({
      scheduled: [pendingRow()],
      sent: [],
    });

    useEmailAccountStore.getState().processDueScheduledLocal();

    const { scheduled, sent } = useEmailAccountStore.getState();
    expect(scheduled[0]?.status).toBe("sent");
    expect(scheduled[0]?.sentAt).toBeTruthy();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe("Local scheduled send test");
    expect(sent[0]?.to).toBe("recipient@example.com");
  });

  it("does not send future scheduled rows", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    useEmailAccountStore.setState({
      scheduled: [pendingRow({ scheduledAt: future })],
      sent: [],
    });

    useEmailAccountStore.getState().processDueScheduledLocal();

    const { scheduled, sent } = useEmailAccountStore.getState();
    expect(scheduled[0]?.status).toBe("pending");
    expect(sent).toHaveLength(0);
  });
});
