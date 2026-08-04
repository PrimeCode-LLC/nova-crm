import type { Contact, EmailVerificationStatus, Lead } from "@/lib/types";

export type EmailVerificationSource = "millionverifier" | "bounce" | "manual";

function isEmailVerificationStatus(value: unknown): value is EmailVerificationStatus {
  return (
    value === "verified" ||
    value === "not_verified" ||
    value === "bounced" ||
    value === "catch_all"
  );
}

function isProviderSource(value: unknown): value is "millionverifier" | "bounce" {
  return value === "millionverifier" || value === "bounce";
}

/**
 * Status for UI badges (prospects table, contact sidebar, etc.).
 *
 * Only trusts Million Verifier / bounce automation. Manual "Email verified"
 * on the qualify form must not show as Verified here.
 */
export function resolveEmailVerificationStatus(
  contact: Contact | undefined | null,
  lead?: Lead | null,
): EmailVerificationStatus {
  if (
    isProviderSource(lead?.emailVerificationSource) &&
    isEmailVerificationStatus(lead?.emailVerificationStatus)
  ) {
    return lead.emailVerificationStatus;
  }
  if (
    isProviderSource(contact?.emailVerificationSource) &&
    isEmailVerificationStatus(contact?.emailVerificationStatus)
  ) {
    return contact.emailVerificationStatus;
  }
  return "not_verified";
}

export function emailVerificationLabel(status: EmailVerificationStatus): string {
  switch (status) {
    case "verified":
      return "Verified";
    case "bounced":
      return "Invalid";
    case "catch_all":
      return "Risky (catch-all)";
    case "not_verified":
    default:
      return "Not verified";
  }
}

/** Longer explanation for badge tooltips / title attributes. */
export function emailVerificationDescription(status: EmailVerificationStatus): string {
  switch (status) {
    case "verified":
      return "Mailbox confirmed by Million Verifier.";
    case "bounced":
      return "Address is invalid or disposable.";
    case "catch_all":
      return "Domain accepts all addresses; inbox not confirmed.";
    case "not_verified":
    default:
      return "Not verified with Million Verifier yet.";
  }
}

/** Show Verify when status is not already provider-verified. */
export function shouldOfferEmailVerify(status: EmailVerificationStatus): boolean {
  return status !== "verified";
}

/** Filter buckets for prospects/leads table (bulk workflows). */
export type EmailVerificationFilterBucket =
  | "verified"
  | "risky"
  | "not_verified"
  | "invalid"
  | "no_email";

export const EMAIL_VERIFICATION_FILTER_OPTIONS: Array<{
  value: EmailVerificationFilterBucket;
  label: string;
}> = [
  { value: "verified", label: "Verified" },
  { value: "risky", label: "Risky (catch-all)" },
  { value: "not_verified", label: "Not verified" },
  { value: "invalid", label: "Invalid" },
  { value: "no_email", label: "No email" },
];

export function emailVerificationFilterBucket(
  status: EmailVerificationStatus,
  email?: string | null,
): EmailVerificationFilterBucket {
  if (!email?.trim()) return "no_email";
  if (status === "verified") return "verified";
  if (status === "catch_all") return "risky";
  if (status === "bounced") return "invalid";
  return "not_verified";
}

export function emailVerificationBadgeClass(status: EmailVerificationStatus): string {
  switch (status) {
    case "verified":
      return "border-success/30 bg-success/10 text-success";
    case "bounced":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "catch_all":
      return "border-warning/30 bg-warning/10 text-warning";
    case "not_verified":
    default:
      return "bg-muted text-muted-foreground";
  }
}
