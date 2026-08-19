import { afterEach, describe, expect, it } from "vitest";
import {
  hasClerkKeys,
  isClerkAuthV1Enabled,
  isClerkAuthV1FlagOn,
  isClerkAuthV1ServerEnabled,
} from "./clerk-flags";

describe("clerk-flags", () => {
  const prev = {
    flag: process.env.AUTH_CLERK_V1,
    publicFlag: process.env.NEXT_PUBLIC_AUTH_CLERK_V1,
    pk: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    sk: process.env.CLERK_SECRET_KEY,
  };

  afterEach(() => {
    restore("AUTH_CLERK_V1", prev.flag);
    restore("NEXT_PUBLIC_AUTH_CLERK_V1", prev.publicFlag);
    restore("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", prev.pk);
    restore("CLERK_SECRET_KEY", prev.sk);
  });

  function restore(key: string, value: string | undefined) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  it("defaults off when explicitly disabled", () => {
    process.env.AUTH_CLERK_V1 = "false";
    delete process.env.NEXT_PUBLIC_AUTH_CLERK_V1;
    expect(isClerkAuthV1FlagOn()).toBe(false);
  });

  it("flag on via AUTH_CLERK_V1 or NEXT_PUBLIC_", () => {
    delete process.env.NEXT_PUBLIC_AUTH_CLERK_V1;
    process.env.AUTH_CLERK_V1 = "true";
    expect(isClerkAuthV1FlagOn()).toBe(true);
    delete process.env.AUTH_CLERK_V1;
    process.env.NEXT_PUBLIC_AUTH_CLERK_V1 = "true";
    expect(isClerkAuthV1FlagOn()).toBe(true);
  });

  it("UI enabled with flag + publishable; server needs secret too", () => {
    process.env.AUTH_CLERK_V1 = "true";
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_x";
    delete process.env.CLERK_SECRET_KEY;
    expect(isClerkAuthV1Enabled()).toBe(true);
    expect(hasClerkKeys()).toBe(false);
    expect(isClerkAuthV1ServerEnabled()).toBe(false);

    process.env.CLERK_SECRET_KEY = "sk_test_x";
    expect(hasClerkKeys()).toBe(true);
    expect(isClerkAuthV1ServerEnabled()).toBe(true);
  });
});
