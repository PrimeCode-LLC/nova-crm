import type { EmailVerificationStatus } from "@/lib/types";

export type MillionVerifierResult =
  | "ok"
  | "catch_all"
  | "unknown"
  | "error"
  | "disposable"
  | "invalid"
  | string;

export type MappedEmailVerification = {
  emailVerificationStatus: EmailVerificationStatus;
  emailVerified: boolean;
  /** When true, clear `emailBouncedAt` on the contact. */
  clearEmailBouncedAt: boolean;
};

/**
 * Map Million Verifier Real-Time API `result` into CRM email verification fields.
 * Only `ok` sets `emailVerified: true` (required for qualify rules).
 */
export function mapMillionVerifierResult(
  result: MillionVerifierResult | null | undefined,
): MappedEmailVerification {
  const normalized = (result ?? "").trim().toLowerCase();

  switch (normalized) {
    case "ok":
      return {
        emailVerificationStatus: "verified",
        emailVerified: true,
        clearEmailBouncedAt: true,
      };
    case "catch_all":
      return {
        emailVerificationStatus: "catch_all",
        emailVerified: false,
        clearEmailBouncedAt: true,
      };
    case "invalid":
    case "disposable":
      return {
        emailVerificationStatus: "bounced",
        emailVerified: false,
        clearEmailBouncedAt: false,
      };
    case "unknown":
    case "error":
    default:
      return {
        emailVerificationStatus: "not_verified",
        emailVerified: false,
        clearEmailBouncedAt: true,
      };
  }
}
