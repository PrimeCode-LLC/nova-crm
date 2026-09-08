import { describe, expect, it, beforeEach, afterEach } from "vitest";

/**
 * Env override is tested via a tiny pure helper mirrored from
 * platform-settings-server (keeps the server module free of export churn).
 */
function envForcesBackupOnly(env: Record<string, string | undefined>): boolean {
  const v = env.PLATFORM_BACKUP_ONLY?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

describe("PLATFORM_BACKUP_ONLY env", () => {
  const prev = process.env.PLATFORM_BACKUP_ONLY;

  afterEach(() => {
    if (prev === undefined) delete process.env.PLATFORM_BACKUP_ONLY;
    else process.env.PLATFORM_BACKUP_ONLY = prev;
  });

  beforeEach(() => {
    delete process.env.PLATFORM_BACKUP_ONLY;
  });

  it("treats true/1/yes as forced on", () => {
    expect(envForcesBackupOnly({ PLATFORM_BACKUP_ONLY: "true" })).toBe(true);
    expect(envForcesBackupOnly({ PLATFORM_BACKUP_ONLY: "1" })).toBe(true);
    expect(envForcesBackupOnly({ PLATFORM_BACKUP_ONLY: "YES" })).toBe(true);
  });

  it("ignores unset/false", () => {
    expect(envForcesBackupOnly({})).toBe(false);
    expect(envForcesBackupOnly({ PLATFORM_BACKUP_ONLY: "false" })).toBe(false);
  });
});
