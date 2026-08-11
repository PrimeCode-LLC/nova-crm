import { describe, expect, it } from "vitest";

import {
  accountRowFromFirestore,
  contactRowFromFirestore,
  leadRowFromFirestore,
  dealRowFromFirestore,
} from "@/lib/db/dual-write-crm";
import {
  isPostgresDualWriteCrmEnabled,
  POSTGRES_DUAL_WRITE_CRM_V1_FLAG,
} from "@/lib/db/dual-write-crm-flags";

describe("postgres_dual_write_crm_v1 flag", () => {
  it("defaults off", () => {
    const prev = process.env.POSTGRES_DUAL_WRITE_CRM_V1;
    delete process.env.POSTGRES_DUAL_WRITE_CRM_V1;
    try {
      expect(isPostgresDualWriteCrmEnabled()).toBe(false);
      expect(POSTGRES_DUAL_WRITE_CRM_V1_FLAG).toBe("postgres_dual_write_crm_v1");
    } finally {
      if (prev === undefined) delete process.env.POSTGRES_DUAL_WRITE_CRM_V1;
      else process.env.POSTGRES_DUAL_WRITE_CRM_V1 = prev;
    }
  });
});

describe("CRM Firestore → Prisma mappers", () => {
  it("maps account", () => {
    const row = accountRowFromFirestore("a1", {
      organizationId: "org1",
      name: "Acme",
      ownerId: "u1",
      contactCount: 2,
      leadCount: 3,
      openDealValue: 1000,
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
    });
    expect(row.name).toBe("Acme");
    expect(row.organizationId).toBe("org1");
    expect(row.leadCount).toBe(3);
  });

  it("maps contact / lead / deal", () => {
    const c = contactRowFromFirestore("c1", {
      organizationId: "org1",
      accountId: "a1",
      firstName: "Ada",
      lastName: "Lovelace",
      fullName: "Ada Lovelace",
      email: "Ada@Example.com",
      ownerId: "u1",
    });
    expect(c.email).toBe("ada@example.com");

    const l = leadRowFromFirestore("l1", {
      organizationId: "org1",
      accountId: "a1",
      contactId: "c1",
      channel: "email",
      stage: "new",
      temperature: "hot",
      priority: "high",
      ownerId: "u1",
      contactName: "Ada",
      companyName: "Acme",
      touches: 1,
      isIdle: false,
    });
    expect(l.companyName).toBe("Acme");

    const d = dealRowFromFirestore("d1", {
      organizationId: "org1",
      leadId: "l1",
      accountId: "a1",
      contactId: "c1",
      name: "Deal",
      stage: "proposal",
      value: 5000,
      currency: "USD",
      probability: 40,
      expectedCloseDate: "2026-09-01T00:00:00.000Z",
      ownerId: "u1",
    });
    expect(d.value).toBe(5000);
    expect(d.probability).toBe(40);
  });

  it("requires organizationId", () => {
    expect(() => accountRowFromFirestore("a1", { name: "x" })).toThrow(/organizationId/);
  });
});
