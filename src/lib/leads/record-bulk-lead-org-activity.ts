import type { OrgActivityEvent, OrgActivityEventType } from "@/lib/types";

export type BulkLeadOrgActivityType = Extract<
  OrgActivityEventType,
  | "leads_sequences_built"
  | "leads_sequences_scheduled"
  | "leads_deleted"
  | "leads_archived"
  | "leads_restored"
>;

export function newOrgActivityId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `oa-${crypto.randomUUID()}`;
  }
  return `oa-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function summarizeBulkLeadOrgActivity(input: {
  type: BulkLeadOrgActivityType;
  count: number;
  emailCount?: number;
  leadLabel?: string;
}): string {
  const label = input.leadLabel?.trim();
  const n = Math.max(0, input.count);

  if (input.type === "leads_sequences_built") {
    if (n === 1 && label) return `Built sequence for “${label}”`;
    if (n === 1) return "Built 1 sequence";
    return `Built ${n} sequences`;
  }

  if (input.type === "leads_sequences_scheduled") {
    const emails =
      typeof input.emailCount === "number" && input.emailCount > 0
        ? input.emailCount
        : undefined;
    const emailSuffix =
      emails === undefined
        ? ""
        : emails === 1
          ? " (1 email)"
          : ` (${emails} emails)`;
    if (n === 1 && label) return `Scheduled sequence for “${label}”${emailSuffix}`;
    if (n === 1) return `Scheduled sequence for 1 lead${emailSuffix}`;
    return `Scheduled sequences for ${n} leads${emailSuffix}`;
  }

  if (input.type === "leads_archived") {
    if (n === 1 && label) return `Archived “${label}”`;
    if (n === 1) return "Archived 1 lead";
    return `Archived ${n} leads`;
  }

  if (input.type === "leads_restored") {
    if (n === 1 && label) return `Restored “${label}” from archive`;
    if (n === 1) return "Restored 1 lead from archive";
    return `Restored ${n} leads from archive`;
  }

  if (n === 1 && label) return `Deleted lead “${label}”`;
  if (n === 1) return "Deleted 1 lead";
  return `Deleted ${n} leads`;
}

/** Builds a dashboard Live activity row for bulk lead ops (client-side via `addOrgActivityEvent`). */
export function buildBulkLeadOrgActivity(input: {
  type: BulkLeadOrgActivityType;
  actorId: string;
  count: number;
  emailCount?: number;
  leadId?: string;
  leadLabel?: string;
}): OrgActivityEvent | null {
  if (input.count < 1) return null;
  const href =
    input.type === "leads_archived" || input.type === "leads_restored"
      ? "/archive"
      : "/leads";
  return {
    id: newOrgActivityId(),
    type: input.type,
    actorId: input.actorId,
    summary: summarizeBulkLeadOrgActivity(input),
    createdAt: new Date().toISOString(),
    href,
    entityType: "lead",
    entityId: input.leadId,
    payload: {
      count: input.count,
      emailCount: input.emailCount ?? null,
      leadId: input.leadId ?? null,
      leadLabel: input.leadLabel ?? null,
    },
  };
}

export function emitBulkLeadOrgActivity(
  addOrgActivityEvent: (e: OrgActivityEvent) => void,
  input: Parameters<typeof buildBulkLeadOrgActivity>[0],
): void {
  const event = buildBulkLeadOrgActivity(input);
  if (event) addOrgActivityEvent(event);
}
