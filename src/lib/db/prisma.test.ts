import { describe, expect, it } from "vitest";

import { getDatabaseUrl, isDatabaseConfigured } from "@/lib/db/prisma";

describe("prisma env helpers (P2.1)", () => {
  it("reports configured when DATABASE_URL is set", () => {
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://nova:nova_dev_password@localhost:5432/nova_crm";
    try {
      expect(isDatabaseConfigured()).toBe(true);
      expect(getDatabaseUrl()).toContain("nova_crm");
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });

  it("reports unconfigured when DATABASE_URL is empty", () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(isDatabaseConfigured()).toBe(false);
      expect(getDatabaseUrl()).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });
});
