import type { CreateUserNotificationInput } from "@/lib/notifications/user-notification-types";

export function leadEntityLabel(lead: {
  contactName?: string;
  companyName?: string;
  intakeKind?: string;
}): { noun: string; label: string; entityType: "lead" | "prospect" } {
  const isProspect = lead.intakeKind === "prospect";
  const noun = isProspect ? "prospect" : "lead";
  const label =
    [lead.contactName?.trim(), lead.companyName?.trim()].filter(Boolean).join(" · ") ||
    (isProspect ? "Prospect" : "Lead");
  return { noun, label, entityType: isProspect ? "prospect" : "lead" };
}

/** Notifications for new + previous owners on a single ownership change. */
export function buildOwnershipHandoffNotifications(input: {
  organizationId: string;
  actorId: string;
  actorName: string;
  previousOwnerId: string;
  nextOwnerId: string;
  leadId: string;
  lead: { contactName?: string; companyName?: string; intakeKind?: string };
  claim?: boolean;
}): CreateUserNotificationInput[] {
  const { noun, label, entityType } = leadEntityLabel(input.lead);
  const href = `/leads/${input.leadId}`;
  const out: CreateUserNotificationInput[] = [];
  const prev = input.previousOwnerId.trim();
  const next = input.nextOwnerId.trim();
  const actor = input.actorName.trim() || "Teammate";

  if (next) {
    out.push({
      organizationId: input.organizationId,
      recipientId: next,
      actorId: input.actorId,
      kind: "assignment",
      message: input.claim
        ? `You claimed ${noun}: ${label}`
        : `${actor} assigned you ${noun}: ${label}`,
      target: label,
      targetHref: href,
      entityType,
      entityId: input.leadId,
      prefKey: "leadAssigned",
    });
  }

  if (prev && prev !== next) {
    out.push({
      organizationId: input.organizationId,
      recipientId: prev,
      actorId: input.actorId,
      kind: "assignment",
      message: next
        ? `${actor} reassigned ${noun} ${label} away from you`
        : `${actor} moved ${noun} ${label} to the open queue`,
      target: label,
      targetHref: href,
      entityType,
      entityId: input.leadId,
      prefKey: "leadAssigned",
    });
  }

  return out;
}
