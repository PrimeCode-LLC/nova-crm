import { contactHasBouncedEmail } from "@/lib/email/contact-email-change";
import type { Contact, Lead } from "@/lib/types";

export type ContactRecipientKind = "company" | "personal";

export type ContactRecipientOption = {
  kind: ContactRecipientKind;
  email: string;
  label: string;
  /** Company address marked bounced - prefer personal when available. */
  bounced?: boolean;
};

function trimEmail(value: string | undefined | null): string {
  return (value ?? "").trim();
}

/** Company + personal recipient choices for schedule / compose To pickers. */
export function buildContactRecipientOptions(
  lead: Pick<Lead, "contactEmail">,
  contact?: Contact | null,
): ContactRecipientOption[] {
  const company = trimEmail(contact?.email) || trimEmail(lead.contactEmail);
  const personal = trimEmail(contact?.personalEmail);
  const bounced = contactHasBouncedEmail(contact);
  const options: ContactRecipientOption[] = [];

  if (company) {
    options.push({
      kind: "company",
      email: company,
      label: bounced ? "Company (bounced)" : "Company",
      bounced: bounced || undefined,
    });
  }

  if (personal && personal.toLowerCase() !== company.toLowerCase()) {
    options.push({
      kind: "personal",
      email: personal,
      label: bounced && company ? "Personal (fallback)" : "Personal",
    });
  }

  return options;
}

/** Prefer company; if company bounced and personal exists, prefer personal. */
export function defaultContactRecipientEmail(
  options: readonly ContactRecipientOption[],
): string {
  if (options.length === 0) return "";
  const company = options.find((o) => o.kind === "company");
  const personal = options.find((o) => o.kind === "personal");
  if (company?.bounced && personal) return personal.email;
  if (company) return company.email;
  return personal?.email ?? options[0]!.email;
}
