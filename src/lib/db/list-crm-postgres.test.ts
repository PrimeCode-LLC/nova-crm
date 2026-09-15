import { afterEach, describe, expect, it } from "vitest";

import type {
  Account as PrismaAccount,
  Contact as PrismaContact,
  Deal as PrismaDeal,
} from "@/generated/prisma/client";
import {
  accountFromPostgresRow,
  contactFromPostgresRow,
  dealFromPostgresRow,
  decodeCrmListCursor,
  encodeCrmListCursor,
  ownedMatchesMemberScope,
  ownedMemberScopeWhere,
} from "@/lib/db/list-crm-postgres";
import {
  isPostgresReadCrmV1Enabled,
  POSTGRES_READ_CRM_V1_FLAG,
} from "@/lib/db/postgres-read-crm-flags";

describe("postgres_read_crm_v1 flag", () => {
  it("is always on after P7 cutover", () => {
    expect(isPostgresReadCrmV1Enabled()).toBe(true);
    expect(POSTGRES_READ_CRM_V1_FLAG).toBe("postgres_read_crm_v1");
  });
});

describe("accountFromPostgresRow", () => {
  it("reconstructs Account from columns + payload", () => {
    const row = {
      id: "a1",
      organizationId: "org1",
      name: "Acme",
      domain: "acme.com",
      industry: "SaaS",
      website: "https://acme.com",
      ownerId: "u1",
      contactCount: 2,
      leadCount: 3,
      openDealValue: 1000,
      payload: {
        organizationId: "org1",
        name: "stale",
        ownerManagerIds: ["mgr1"],
        location: "NYC",
      },
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-11T00:00:00.000Z"),
    } as unknown as PrismaAccount;

    const account = accountFromPostgresRow(row);
    expect(account.id).toBe("a1");
    expect(account.name).toBe("Acme");
    expect(account.domain).toBe("acme.com");
    expect(account.ownerManagerIds).toEqual(["mgr1"]);
    expect(account.location).toBe("NYC");
    expect(account.createdAt).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("contactFromPostgresRow", () => {
  it("reconstructs Contact from columns + payload", () => {
    const row = {
      id: "c1",
      organizationId: "org1",
      accountId: "a1",
      firstName: "Ada",
      lastName: "Lovelace",
      fullName: "Ada Lovelace",
      email: "ada@acme.com",
      phone: null,
      title: "Engineer",
      ownerId: "u1",
      payload: {
        ownerManagerIds: ["mgr1"],
        linkedin: "https://linkedin.com/in/ada",
      },
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-11T00:00:00.000Z"),
    } as unknown as PrismaContact;

    const contact = contactFromPostgresRow(row);
    expect(contact.id).toBe("c1");
    expect(contact.fullName).toBe("Ada Lovelace");
    expect(contact.email).toBe("ada@acme.com");
    expect(contact.linkedin).toBe("https://linkedin.com/in/ada");
    expect(contact.ownerManagerIds).toEqual(["mgr1"]);
  });
});

describe("dealFromPostgresRow", () => {
  it("reconstructs Deal from columns + payload", () => {
    const row = {
      id: "d1",
      organizationId: "org1",
      leadId: "l1",
      accountId: "a1",
      contactId: "c1",
      name: "Acme deal",
      stage: "proposal",
      value: 5000,
      currency: "USD",
      probability: 40,
      expectedCloseDate: new Date("2026-09-01T00:00:00.000Z"),
      ownerId: "u1",
      wonAt: null,
      lostAt: null,
      payload: {
        ownerManagerIds: ["mgr1"],
        notes: "hot",
      },
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-11T00:00:00.000Z"),
    } as unknown as PrismaDeal;

    const deal = dealFromPostgresRow(row);
    expect(deal.id).toBe("d1");
    expect(deal.name).toBe("Acme deal");
    expect(deal.stage).toBe("proposal");
    expect(deal.value).toBe(5000);
    expect(deal.expectedCloseDate).toBe("2026-09-01T00:00:00.000Z");
    expect(deal.notes).toBe("hot");
  });
});

describe("crm list cursor helpers", () => {
  it("round-trips cursor", () => {
    const at = new Date("2026-08-11T12:00:00.000Z");
    const encoded = encodeCrmListCursor(at, "acct_abc");
    expect(decodeCrmListCursor(encoded)).toEqual({ updatedAt: at, id: "acct_abc" });
    expect(decodeCrmListCursor("bad")).toBeNull();
  });
});

describe("ownedMatchesMemberScope", () => {
  it("matches owner", () => {
    expect(ownedMatchesMemberScope({ ownerId: "u1" }, "u1")).toBe(true);
  });

  it("matches ownerManagerIds", () => {
    expect(ownedMatchesMemberScope({ ownerId: "other", ownerManagerIds: ["u1"] }, "u1")).toBe(
      true,
    );
  });

  it("rejects unrelated viewer", () => {
    expect(ownedMatchesMemberScope({ ownerId: "other", ownerManagerIds: ["mgr"] }, "u1")).toBe(
      false,
    );
  });
});

describe("ownedMemberScopeWhere", () => {
  it("returns never-match when uid empty", () => {
    expect(ownedMemberScopeWhere("")).toEqual({ id: "__never__" });
  });

  it("ORs ownerId with payload ownerManagerIds", () => {
    expect(ownedMemberScopeWhere("u1")).toEqual({
      OR: [
        { ownerId: "u1" },
        { payload: { path: ["ownerManagerIds"], array_contains: "u1" } },
      ],
    });
  });
});
