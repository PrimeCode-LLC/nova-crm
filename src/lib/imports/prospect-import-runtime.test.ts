import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getUnsafeLocalImportError,
  isLocalDatabaseUrl,
} from "@/lib/imports/prospect-import-runtime";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isLocalDatabaseUrl", () => {
  it("accepts localhost and compose hosts", () => {
    expect(
      isLocalDatabaseUrl("postgres://nova_app:pass@localhost:5432/nova_crm"),
    ).toBe(true);
    expect(
      isLocalDatabaseUrl("postgresql://nova_app:pass@127.0.0.1:5432/nova_crm"),
    ).toBe(true);
    expect(
      isLocalDatabaseUrl("postgres://nova_app:pass@postgres:5432/nova_crm"),
    ).toBe(true);
  });

  it("rejects remote hosts", () => {
    expect(
      isLocalDatabaseUrl("postgres://nova_app:pass@db.example.com:5432/nova_crm"),
    ).toBe(false);
  });
});

describe("getUnsafeLocalImportError", () => {
  it("allows local Compose DATABASE_URL in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://nova_app:nova_dev_password@localhost:5432/nova_crm",
    );
    vi.stubEnv("ALLOW_LIVE_IMPORTS_IN_DEVELOPMENT", "");
    expect(getUnsafeLocalImportError()).toBeNull();
  });

  it("blocks remote DATABASE_URL in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://nova_app:secret@prod.example.com:5432/nova_crm",
    );
    vi.stubEnv("ALLOW_LIVE_IMPORTS_IN_DEVELOPMENT", "");
    expect(getUnsafeLocalImportError()).toMatch(/remote database/i);
  });

  it("allows production NODE_ENV", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://nova_app:secret@prod.example.com:5432/nova_crm",
    );
    expect(getUnsafeLocalImportError()).toBeNull();
  });
});
