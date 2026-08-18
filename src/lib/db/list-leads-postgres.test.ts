import { afterEach, describe, expect, it } from "vitest";

import type { Lead as PrismaLead } from "@/generated/prisma/client";
import {
  leadFromPostgresRow,
  leadMatchesMemberScope,
} from "@/lib/db/list-leads-postgres";
import {
  isPostgresReadLeadsV1Enabled,
  POSTGRES_READ_LEADS_V1_FLAG,
} from "@/lib/db/postgres-read-leads-flags";
import type { Lead } from "@/lib/types";

describe("postgres_read_leads_v1 flag", () => {
  const prev = {
    server: process.env.POSTGRES_READ_LEADS_V1,
    public: process.env.NEXT_PUBLIC_POSTGRES_READ_LEADS_V1,
  };

  afterEach(() => {
    if (prev.server === undefined) delete process.env.POSTGRES_READ_LEADS_V1;
    else process.env.POSTGRES_READ_LEADS_V1 = prev.server;
    if (prev.public === undefined) delete process.env.NEXT_PUBLIC_POSTGRES_READ_LEADS_V1;
    else process.env.NEXT_PUBLIC_POSTGRES_READ_LEADS_V1 = prev.public;
  });

  it("defaults off", () => {
    delete process.env.POSTGRES_READ_LEADS_V1;
    delete process.env.NEXT_PUBLIC_POSTGRES_READ_LEADS_V1;
    expect(isPostgresReadLeadsV1Enabled()).toBe(false);
    expect(POSTGRES_READ_LEADS_V1_FLAG).toBe("postgres_read_leads_v1");
  });

  it("is on when POSTGRES_READ_LEADS_V1=true", () => {
    process.env.POSTGRES_READ_LEADS_V1 = "true";
    delete process.env.NEXT_PUBLIC_POSTGRES_READ_LEADS_V1;
    expect(isPostgresReadLeadsV1Enabled()).toBe(true);
  });

  it("is on when NEXT_PUBLIC_POSTGRES_READ_LEADS_V1=true", () => {
    delete process.env.POSTGRES_READ_LEADS_V1;
    process.env.NEXT_PUBLIC_POSTGRES_READ_LEADS_V1 = "true";
    expect(isPostgresReadLeadsV1Enabled()).toBe(true);
  });
});

describe("leadFromPostgresRow", () => {
  it("reconstructs Lead from columns + payload", () => {
    const row = {
      id: "l1",
      organizationId: "org1",
      accountId: "a1",
      contactId: "c1",
      channel: "email",
      stage: "qualified",
      temperature: "hot",
      priority: "high",
      ownerId: "u1",
      contactName: "Ada",
      companyName: "Acme",
      intakeKind: "sales_lead",
      touches: 2,
      isIdle: false,
      archivedAt: null,
      payload: {
        organizationId: "org1",
        stage: "stale-in-payload",
        ownerManagerIds: ["mgr1"],
        sharedOwnerIds: ["share1"],
      },
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-11T00:00:00.000Z"),
    } as unknown as PrismaLead;

    const lead = leadFromPostgresRow(row);
    expect(lead.id).toBe("l1");
    expect(lead.stage).toBe("qualified");
    expect(lead.companyName).toBe("Acme");
    expect(lead.ownerManagerIds).toEqual(["mgr1"]);
    expect(lead.sharedOwnerIds).toEqual(["share1"]);
    expect(lead.createdAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("strips heavy payload keys by default", () => {
    const row = {
      id: "l2",
      organizationId: "org1",
      accountId: "a1",
      contactId: "c1",
      channel: "email",
      stage: "new",
      temperature: "warm",
      priority: "medium",
      ownerId: "u1",
      contactName: "Bob",
      companyName: "Co",
      intakeKind: null,
      touches: 0,
      isIdle: false,
      archivedAt: null,
      payload: {
        estimatedValue: 500,
        scrapeHtml: "<html>huge</html>",
        aiContext: { big: true },
        notes: "x".repeat(2500),
      },
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-11T00:00:00.000Z"),
    } as unknown as PrismaLead;

    const lead = leadFromPostgresRow(row);
    expect(lead.estimatedValue).toBe(500);
    expect((lead as { scrapeHtml?: string }).scrapeHtml).toBeUndefined();
    expect((lead as { aiContext?: unknown }).aiContext).toBeUndefined();
    expect(lead.notes?.endsWith("…")).toBe(true);
    expect((lead.notes?.length ?? 0) <= 2001).toBe(true);
  });
});

describe("leads list cursor helpers", () => {
  it("round-trips cursor", async () => {
    const { encodeLeadsListCursor, decodeLeadsListCursor } = await import(
      "@/lib/db/list-leads-postgres"
    );
    const at = new Date("2026-08-11T12:00:00.000Z");
    const encoded = encodeLeadsListCursor(at, "lead_abc");
    expect(decodeLeadsListCursor(encoded)).toEqual({ updatedAt: at, id: "lead_abc" });
    expect(decodeLeadsListCursor("bad")).toBeNull();
  });
});

describe("leadMatchesMemberScope", () => {
  const base = {
    id: "l1",
    accountId: "a1",
    contactId: "c1",
    channel: "email",
    stage: "new",
    temperature: "warm",
    priority: "medium",
    ownerId: "other",
    contactName: "X",
    companyName: "Y",
    touches: 0,
    isIdle: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  } as unknown as Lead;

  it("matches owner", () => {
    expect(leadMatchesMemberScope({ ...base, ownerId: "u1" }, "u1")).toBe(true);
  });

  it("matches ownerManagerIds", () => {
    expect(
      leadMatchesMemberScope({ ...base, ownerManagerIds: ["u1"] }, "u1"),
    ).toBe(true);
  });

  it("matches prospect assignee", () => {
    expect(
      leadMatchesMemberScope(
        { ...base, intakeKind: "prospect", prospectAssigneeIds: ["u1"] },
        "u1",
      ),
    ).toBe(true);
  });

  it("matches sharedOwnerIds", () => {
    expect(
      leadMatchesMemberScope({ ...base, sharedOwnerIds: ["u1"] }, "u1"),
    ).toBe(true);
  });

  it("rejects unrelated viewer", () => {
    expect(leadMatchesMemberScope(base, "u1")).toBe(false);
  });
});
