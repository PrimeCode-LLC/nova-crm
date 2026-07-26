import { labelForAuditEvent } from "@/lib/firestore/audit-events";
import type { AuditEvent, AuditLogRecord } from "@/lib/firestore/audit";

export type AuditOperation =
  | "create"
  | "update"
  | "delete"
  | "view"
  | "sync"
  | "action";

export type AuditLogDetail = {
  operation?: AuditOperation | null;
  tableName?: string | null;
  fieldName?: string | null;
  message?: string | null;
  prevValue?: string | null;
  updatedValue?: string | null;
  actorEmail?: string | null;
};

export type AuditLogRecordWithDetail = AuditLogRecord & Required<AuditLogDetail>;

const VALUE_MAX_LEN = 4_000;

export function formatAuditValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    return value.length > VALUE_MAX_LEN ? `${value.slice(0, VALUE_MAX_LEN - 1)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const raw = JSON.stringify(value);
    return raw.length > VALUE_MAX_LEN ? `${raw.slice(0, VALUE_MAX_LEN - 1)}…` : raw;
  } catch {
    return String(value);
  }
}

type EventDefault = {
  operation: AuditOperation;
  tableName: string;
  fieldName?: string | null;
  message?: (meta: Record<string, unknown>) => string;
};

export const AUDIT_EVENT_DEFAULTS: Record<AuditEvent, EventDefault> = {
  "member.invited": {
    operation: "create",
    tableName: "invites",
    fieldName: "email",
    message: (m) => `Invited ${String(m.email ?? "member")} as ${String(m.role ?? "member")}`,
  },
  "member.provisioned": {
    operation: "create",
    tableName: "members",
    fieldName: "email",
    message: (m) => `Provisioned login for ${String(m.email ?? "member")}`,
  },
  "member.joined": {
    operation: "create",
    tableName: "members",
    message: (m) => `Member joined (${String(m.email ?? m.uid ?? "unknown")})`,
  },
  "member.approved": {
    operation: "update",
    tableName: "members",
    fieldName: "status",
    message: () => "Member approved",
  },
  "member.role_changed": {
    operation: "update",
    tableName: "members",
    fieldName: "role",
    message: (m) => `Changed member role to ${String(m.role ?? m.updatedValue ?? "unknown")}`,
  },
  "member.disabled": {
    operation: "update",
    tableName: "members",
    fieldName: "status",
    message: () => "Member disabled",
  },
  "member.enabled": {
    operation: "update",
    tableName: "members",
    fieldName: "status",
    message: () => "Member re-enabled",
  },
  "member.removed": {
    operation: "delete",
    tableName: "members",
    message: (m) => `Removed member ${String(m.uid ?? "")}`,
  },
  "org.open_join_link_rotated": {
    operation: "update",
    tableName: "organizations",
    fieldName: "openJoinToken",
    message: () => "Open join link rotated",
  },
  "org.open_join_link_cleared": {
    operation: "update",
    tableName: "organizations",
    fieldName: "openJoinToken",
    message: () => "Open join link cleared",
  },
  "invite.revoked": {
    operation: "delete",
    tableName: "invites",
    message: (m) => `Revoked invite ${String(m.inviteId ?? "")}`,
  },
  "lead.created": {
    operation: "create",
    tableName: "leads",
    message: (m) => {
      const entity = m.tableName === "prospects" ? "Prospect" : "Lead";
      const name = m.leadName ? ` (${String(m.leadName)})` : "";
      return `${entity} created${name}`;
    },
  },
  "lead.stage_changed": {
    operation: "update",
    tableName: "leads",
    fieldName: "stage",
    message: (m) =>
      `Lead stage changed from ${String(m.prevValue ?? "?")} to ${String(m.updatedValue ?? m.stage ?? "?")}`,
  },
  "deal.created": {
    operation: "create",
    tableName: "deals",
    message: (m) => `Deal created (${String(m.dealName ?? m.recordId ?? m.dealId ?? "")})`,
  },
  "deal.stage_changed": {
    operation: "update",
    tableName: "deals",
    fieldName: "stage",
    message: (m) =>
      `Deal stage changed from ${String(m.prevValue ?? "?")} to ${String(m.updatedValue ?? m.stage ?? "?")}`,
  },
  "deal.won": {
    operation: "update",
    tableName: "deals",
    fieldName: "stage",
    message: () => "Deal marked won",
  },
  "deal.lost": {
    operation: "update",
    tableName: "deals",
    fieldName: "stage",
    message: () => "Deal marked lost",
  },
  "settings.updated": {
    operation: "update",
    tableName: "organizations",
    message: (m) => {
      const fields = Array.isArray(m.fields) ? m.fields.join(", ") : "settings";
      return `Organization settings updated (${fields})`;
    },
  },
  "channel_admin.updated": {
    operation: "update",
    tableName: "organizations",
    fieldName: "channelConfig",
    message: (m) =>
      `Channels updated (${String(m.customChannelCount ?? "?")} custom channel${Number(m.customChannelCount) === 1 ? "" : "s"})`,
  },
  "user.hierarchy_updated": {
    operation: "update",
    tableName: "users",
    message: (m) => `Org hierarchy updated for ${String(m.targetUid ?? "user")}`,
  },
  "user.feature_grants_updated": {
    operation: "update",
    tableName: "users",
    fieldName: "featureGrants",
    message: (m) => `Feature access updated for ${String(m.targetUid ?? "user")}`,
  },
  "user.profile_updated": {
    operation: "update",
    tableName: "users",
    fieldName: "status",
    message: (m) => {
      const status = typeof m.status === "string" ? ` → ${m.status}` : "";
      return `CRM profile updated for ${String(m.targetUid ?? "user")}${status}`;
    },
  },
  "ai.settings_updated": {
    operation: "update",
    tableName: "aiSettings",
    message: (m) => {
      const fields = Array.isArray(m.fields)
        ? m.fields.join(", ")
        : String(m.feature ?? "settings");
      return `AI settings updated (${fields})`;
    },
  },
  "ai.key_rotated": {
    operation: "update",
    tableName: "aiProviderSecrets",
    fieldName: "providers",
    message: (m) => {
      const providers = Array.isArray(m.providers) ? m.providers.join(", ") : "providers";
      return `AI provider keys rotated (${providers})`;
    },
  },
  "ai.library_indexed": {
    operation: "update",
    tableName: "aiDocuments",
    message: (m) =>
      `AI knowledge indexed (library ${String(m.libraryId ?? m.globalLibraryId ?? "")})`,
  },
  "instantly.connected": {
    operation: "update",
    tableName: "integrationSecrets",
    fieldName: "instantly",
    message: () => "Instantly connected",
  },
  "instantly.disconnected": {
    operation: "update",
    tableName: "integrationSecrets",
    fieldName: "instantly",
    message: () => "Instantly disconnected",
  },
  "instantly.campaign_created": {
    operation: "create",
    tableName: "campaigns",
    message: (m) => `Instantly campaign created (${String(m.campaignId ?? "")})`,
  },
  "instantly.campaigns_synced": {
    operation: "sync",
    tableName: "campaigns",
    message: () => "Instantly campaigns synced",
  },
  "instantly.campaign_leads_synced": {
    operation: "sync",
    tableName: "campaigns",
    message: (m) => `Instantly campaign leads synced (${String(m.campaignId ?? "")})`,
  },
  "instantly.leads_pushed": {
    operation: "update",
    tableName: "campaigns",
    message: (m) => `Pushed ${String(m.count ?? "?")} leads to Instantly`,
  },
  "instantly.webhook_reply": {
    operation: "action",
    tableName: "leads",
    message: (m) => `Instantly reply received from ${String(m.email ?? "contact")}`,
  },
  "feature.page_view": {
    operation: "view",
    tableName: "pages",
    fieldName: "path",
    message: (m) => `Visited ${String(m.feature ?? m.label ?? m.path ?? "page")}`,
  },
  "feature.fit_check": {
    operation: "action",
    tableName: "opportunityScans",
    message: (m) => `Fit Check run (${String(m.title ?? m.scanId ?? "")})`,
  },
  "feature.intent_radar_evaluate": {
    operation: "action",
    tableName: "intentRadar",
    message: (m) =>
      `Intent Radar AI evaluate (${String(m.verdict ?? "")} · combined ${String(m.combined ?? m.fitScore ?? "")}${m.pageType ? ` · ${String(m.pageType)}` : ""})`,
  },
  "feature.lead_analyze": {
    operation: "action",
    tableName: "leads",
    message: (m) => `Lead AI analysis (${String(m.leadId ?? "")})`,
  },
  "feature.intent_suggest": {
    operation: "action",
    tableName: "leads",
    message: (m) => `Intent signal suggestions (${String(m.leadId ?? "")})`,
  },
  "feature.followup_suggest": {
    operation: "action",
    tableName: "leads",
    message: (m) => `AI follow-up suggestions (${String(m.leadId ?? "")})`,
  },
  "feature.dashboard_brief": {
    operation: "action",
    tableName: "aiBriefHistory",
    message: () => "Dashboard AI brief generated",
  },
  "feature.outreach_view": {
    operation: "view",
    tableName: "pages",
    fieldName: "path",
    message: (m) => `Opened email outreach (${String(m.path ?? "")})`,
  },
  "feature.import": {
    operation: "action",
    tableName: "leads",
    message: () => "Data import",
  },
  "activity.counter_logged": {
    operation: "create",
    tableName: "activityCounters",
    message: (m) => {
      const channel = String(m.channel ?? "channel");
      const total = Object.values((m.counters as Record<string, number>) ?? {}).reduce(
        (s, n) => s + (typeof n === "number" ? n : 0),
        0,
      );
      return `Logged ${total} activity count${total === 1 ? "" : "s"} for ${channel}`;
    },
  },
  "scraper.feeds_seed": {
    operation: "create",
    tableName: "scraperFeeds",
    message: (m) => `Scraper feeds seeded (${String(m.created ?? 0)} created)`,
  },
  "scraper.run": {
    operation: "sync",
    tableName: "scraperFeeds",
    message: (m) => `Scraper run (${String(m.feedCount ?? "?")} feeds)`,
  },
  "scraper.feed_create": {
    operation: "create",
    tableName: "scraperFeeds",
    message: (m) => `Scraper feed created (${String(m.name ?? m.feedId ?? "")})`,
  },
  "scraper.feed_delete": {
    operation: "delete",
    tableName: "scraperFeeds",
    message: (m) => `Scraper feed deleted (${String(m.feedId ?? "")})`,
  },
  "scraper.raw_promote": {
    operation: "update",
    tableName: "scraperRawItems",
    message: (m) => `Intake item promoted to prospect (${String(m.leadId ?? "")})`,
  },
  "intake_filter_defaults.updated": {
    operation: "update",
    tableName: "organizations",
    fieldName: "intakeFilterDefaults",
    message: (m) =>
      `Team intake filters updated (${String(m.includeCount ?? 0)} include, ${String(m.excludeCount ?? 0)} exclude)`,
  },
  "intent_playbook.updated": {
    operation: "update",
    tableName: "organizations",
    fieldName: "intentPlaybook",
    message: (m) =>
      `Intent playbook updated (${String(m.signalCount ?? 0)} signals, threshold ${String(m.threshold ?? "")})`,
  },
  "intent_playbook.template_applied": {
    operation: "update",
    tableName: "organizations",
    fieldName: "intentPlaybook",
    message: (m) => `Intent playbook template applied (${String(m.templateId ?? "")})`,
  },
  "strategy.created": {
    operation: "create",
    tableName: "prospectingStrategies",
    message: (m) => `Strategy created (${String(m.strategyName ?? m.strategyId ?? "")})`,
  },
  "strategy.updated": {
    operation: "update",
    tableName: "prospectingStrategies",
    message: (m) => `Strategy updated (${String(m.strategyName ?? m.strategyId ?? "")})`,
  },
  "strategy.deleted": {
    operation: "delete",
    tableName: "prospectingStrategies",
    message: (m) => `Strategy deleted (${String(m.strategyName ?? m.strategyId ?? "")})`,
  },
  "strategy.assigned": {
    operation: "update",
    tableName: "strategyAssignments",
    message: (m) =>
      `Strategy assignment ${String(m.action ?? "updated")} (${String(m.strategyName ?? m.strategyId ?? "")})`,
  },
  "strategy.pack_imported": {
    operation: "create",
    tableName: "prospectingStrategies",
    message: (m) => `Strategy pack imported (${String(m.strategyName ?? m.strategyId ?? "")})`,
  },
  "extension.auth_login": {
    operation: "action",
    tableName: "extensionSessions",
    message: () => "Intent Radar signed in",
  },
  "extension.auth_logout": {
    operation: "action",
    tableName: "extensionSessions",
    message: () => "Intent Radar signed out",
  },
  "extension.finding_saved": {
    operation: "create",
    tableName: "extensionFindings",
    message: (m) => `Intent Radar finding saved (${String(m.action ?? "scan")})`,
  },
  "role.created": {
    operation: "create",
    tableName: "roles",
    message: (m) => `CRM role created (${String(m.roleName ?? m.roleId ?? "")})`,
  },
  "role.updated": {
    operation: "update",
    tableName: "roles",
    message: (m) => `CRM role updated (${String(m.roleName ?? m.roleId ?? "")})`,
  },
  "role.deleted": {
    operation: "delete",
    tableName: "roles",
    message: (m) => `CRM role deleted (${String(m.roleName ?? m.roleId ?? "")})`,
  },
  "role.reset": {
    operation: "update",
    tableName: "roles",
    message: (m) => `CRM role reset to default (${String(m.roleName ?? m.roleId ?? "")})`,
  },
};

export function buildAuditMessage(
  event: AuditEvent,
  meta: Record<string, unknown>,
  detail?: AuditLogDetail,
): string {
  if (detail?.message) return detail.message;
  const defaults = AUDIT_EVENT_DEFAULTS[event];
  if (defaults?.message) return defaults.message(meta);
  return labelForAuditEvent(event);
}

function derivePrevUpdatedFromMeta(
  event: AuditEvent,
  meta: Record<string, unknown>,
): { prevValue: string | null; updatedValue: string | null; fieldName: string | null } {
  const defaults = AUDIT_EVENT_DEFAULTS[event];
  let fieldName = defaults?.fieldName ?? null;
  let prevValue: string | null = null;
  let updatedValue: string | null = null;

  if (typeof meta.prevValue === "string" || meta.prevValue === null) {
    prevValue = meta.prevValue as string | null;
  } else if (meta.prevValue !== undefined) {
    prevValue = formatAuditValue(meta.prevValue);
  }

  if (typeof meta.updatedValue === "string" || meta.updatedValue === null) {
    updatedValue = meta.updatedValue as string | null;
  } else if (meta.updatedValue !== undefined) {
    updatedValue = formatAuditValue(meta.updatedValue);
  } else if (typeof meta.role === "string") {
    updatedValue = meta.role;
    fieldName = fieldName ?? "role";
  } else if (typeof meta.status === "string") {
    updatedValue = meta.status;
    fieldName = fieldName ?? "status";
  } else if (typeof meta.stage === "string") {
    updatedValue = meta.stage;
    fieldName = fieldName ?? "stage";
  } else if (typeof meta.path === "string") {
    updatedValue = meta.path;
    fieldName = fieldName ?? "path";
  } else if (typeof meta.email === "string" && event.startsWith("member.")) {
    updatedValue = meta.email;
    fieldName = fieldName ?? "email";
  } else if (typeof meta.name === "string") {
    updatedValue = meta.name;
  }

  if (typeof meta.leadName === "string") {
    updatedValue = meta.leadName;
    fieldName = "lead";
  }

  if (typeof meta.fieldName === "string") fieldName = meta.fieldName;

  return { prevValue, updatedValue, fieldName };
}

export function projectLegacyAuditRow(row: AuditLogRecord): AuditLogRecordWithDetail {
  const event = row.event as AuditEvent;
  const defaults = AUDIT_EVENT_DEFAULTS[event];
  const derived = derivePrevUpdatedFromMeta(event, row.meta);

  const operation: AuditOperation =
    (row.operation as AuditOperation | null | undefined) ??
    defaults?.operation ??
    (event.includes("created") || event.includes("invited") || event.includes("provisioned")
      ? "create"
      : event.includes("deleted") || event.includes("removed") || event.includes("revoked")
        ? "delete"
        : event.startsWith("feature.page") || event.includes("view")
          ? "view"
          : event.includes("sync")
            ? "sync"
            : "update");

  const tableName = row.tableName ?? defaults?.tableName ?? "unknown";
  const fieldName = row.fieldName ?? derived.fieldName ?? null;
  const prevValue = row.prevValue ?? derived.prevValue ?? null;
  const updatedValue = row.updatedValue ?? derived.updatedValue ?? null;
  const message = buildAuditMessage(event, row.meta, {
    message: row.message,
    prevValue,
    updatedValue,
  });

  return {
    ...row,
    operation,
    tableName,
    fieldName,
    message,
    prevValue,
    updatedValue,
    actorEmail: row.actorEmail ?? null,
  };
}
