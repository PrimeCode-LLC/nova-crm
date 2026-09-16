import type { QualifyIssue } from "@/lib/prospecting-strategy/qualify";

/** Stable DOM anchors for qualify-gate issues (data-prospect-field / scroll targets). */
export const QUALIFY_FIELD_ORDER = [
  "do_not_contact",
  "company_name",
  "company_website",
  "contact_name",
  "contact_title",
  "contact_linkedin",
  "verified_email",
  "intent_evidence",
  "personalization",
  "opportunity",
  "quality_score",
  "max_contacts",
] as const;

export type QualifyFieldCode = (typeof QUALIFY_FIELD_ORDER)[number];

export function prospectFieldAnchorId(code: string): string {
  return `prospect-field-${code}`;
}

export function issuesToFieldErrors(
  issues: readonly QualifyIssue[],
): Partial<Record<string, string>> {
  const errors: Partial<Record<string, string>> = {};
  for (const issue of issues) {
    if (!issue.blocking) continue;
    if (!errors[issue.code]) errors[issue.code] = issue.message;
  }
  return errors;
}

/** First blocking issue in gate order (form top → bottom). */
export function firstQualifyFieldCode(
  issues: readonly QualifyIssue[],
): string | null {
  const blocking = new Set(
    issues.filter((i) => i.blocking).map((i) => i.code),
  );
  for (const code of QUALIFY_FIELD_ORDER) {
    if (blocking.has(code)) return code;
  }
  const fallback = issues.find((i) => i.blocking);
  return fallback?.code ?? null;
}

export function scrollToProspectField(
  code: string,
  root?: ParentNode | null,
): void {
  const scope = root ?? document;
  const el =
    scope.querySelector<HTMLElement>(`#${prospectFieldAnchorId(code)}`) ??
    scope.querySelector<HTMLElement>(`[data-prospect-field="${code}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const focusable = el.querySelector<HTMLElement>(
    "input:not([type=hidden]), textarea, select, button, [role='combobox']",
  );
  focusable?.focus({ preventScroll: true });
}
