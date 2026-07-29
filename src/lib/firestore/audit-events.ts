import type { AuditEvent } from "@/lib/firestore/audit";

/** Human-readable labels for audit log UI and exports. */
export const AUDIT_EVENT_LABELS: Record<AuditEvent, string> = {
  "member.invited": "Team invite sent",
  "member.provisioned": "Login provisioned",
  "member.joined": "Member joined workspace",
  "member.approved": "Member approved",
  "member.role_changed": "Member role changed",
  "member.disabled": "Member disabled",
  "member.enabled": "Member re-enabled",
  "member.removed": "Member removed",
  "org.open_join_link_rotated": "Open join link rotated",
  "org.open_join_link_cleared": "Open join link cleared",
  "invite.revoked": "Invite revoked",
  "lead.created": "Lead created",
  "lead.stage_changed": "Lead stage changed",
  "deal.created": "Deal created",
  "deal.stage_changed": "Deal stage changed",
  "deal.won": "Deal won",
  "deal.lost": "Deal lost",
  "activity.counter_logged": "Daily activity counters logged",
  "settings.updated": "Organization settings updated",
  "channel_admin.updated": "Channels updated",
  "user.hierarchy_updated": "Org hierarchy updated",
  "user.feature_grants_updated": "Feature access updated",
  "user.profile_updated": "CRM profile updated",
  "ai.settings_updated": "AI settings updated",
  "ai.key_rotated": "AI provider key rotated",
  "ai.library_indexed": "AI knowledge indexed",
  "instantly.connected": "Instantly connected",
  "instantly.disconnected": "Instantly disconnected",
  "instantly.campaign_created": "Instantly campaign created",
  "instantly.campaigns_synced": "Instantly campaigns synced",
  "instantly.campaign_leads_synced": "Instantly campaign leads synced",
  "instantly.leads_pushed": "Leads pushed to Instantly",
  "instantly.webhook_reply": "Instantly reply received",
  "millionverifier.connected": "Million Verifier connected",
  "millionverifier.disconnected": "Million Verifier disconnected",
  "feature.page_view": "Page visited",
  "feature.fit_check": "Fit Check run",
  "feature.intent_radar_evaluate": "Intent Radar AI evaluate",
  "feature.lead_analyze": "Lead AI analysis",
  "feature.intent_suggest": "Intent signal suggestions",
  "feature.followup_suggest": "AI follow-up suggestions",
  "feature.dashboard_brief": "Dashboard AI brief",
  "feature.outreach_view": "Email outreach opened",
  "feature.import": "Data import",
  "scraper.feeds_seed": "Scraper feeds seeded",
  "scraper.run": "Scraper feeds run",
  "scraper.feed_create": "Scraper feed created",
  "scraper.feed_delete": "Scraper feed deleted",
  "scraper.raw_promote": "Intake item promoted to prospect",
  "intake_filter_defaults.updated": "Team intake filters updated",
  "intent_playbook.updated": "Intent playbook updated",
  "intent_playbook.template_applied": "Intent playbook template applied",
  "strategy.created": "Strategy created",
  "strategy.updated": "Strategy updated",
  "strategy.deleted": "Strategy deleted",
  "strategy.assigned": "Strategy assignment changed",
  "strategy.pack_imported": "Strategy pack imported",
  "extension.auth_login": "Intent Radar signed in",
  "extension.auth_logout": "Intent Radar signed out",
  "extension.finding_saved": "Intent Radar finding saved",
  "role.created": "CRM role created",
  "role.updated": "CRM role updated",
  "role.deleted": "CRM role deleted",
  "role.reset": "CRM role reset to default",
};

export type AuditEventCategory =
  | "team"
  | "crm"
  | "ai"
  | "integrations"
  | "settings"
  | "usage";

export const AUDIT_EVENT_CATEGORY: Record<AuditEvent, AuditEventCategory> = {
  "member.invited": "team",
  "member.provisioned": "team",
  "member.joined": "team",
  "member.approved": "team",
  "member.role_changed": "team",
  "member.disabled": "team",
  "member.enabled": "team",
  "member.removed": "team",
  "org.open_join_link_rotated": "team",
  "org.open_join_link_cleared": "team",
  "invite.revoked": "team",
  "lead.created": "crm",
  "lead.stage_changed": "crm",
  "deal.created": "crm",
  "deal.stage_changed": "crm",
  "deal.won": "crm",
  "deal.lost": "crm",
  "activity.counter_logged": "crm",
  "settings.updated": "settings",
  "channel_admin.updated": "settings",
  "user.hierarchy_updated": "settings",
  "user.feature_grants_updated": "settings",
  "user.profile_updated": "settings",
  "ai.settings_updated": "ai",
  "ai.key_rotated": "ai",
  "ai.library_indexed": "ai",
  "instantly.connected": "integrations",
  "instantly.disconnected": "integrations",
  "instantly.campaign_created": "integrations",
  "instantly.campaigns_synced": "integrations",
  "instantly.campaign_leads_synced": "integrations",
  "instantly.leads_pushed": "integrations",
  "instantly.webhook_reply": "integrations",
  "millionverifier.connected": "integrations",
  "millionverifier.disconnected": "integrations",
  "feature.page_view": "usage",
  "feature.fit_check": "usage",
  "feature.intent_radar_evaluate": "usage",
  "feature.lead_analyze": "usage",
  "feature.intent_suggest": "usage",
  "feature.followup_suggest": "usage",
  "feature.dashboard_brief": "usage",
  "feature.outreach_view": "usage",
  "feature.import": "usage",
  "scraper.feeds_seed": "crm",
  "scraper.run": "crm",
  "scraper.feed_create": "crm",
  "scraper.feed_delete": "crm",
  "scraper.raw_promote": "crm",
  "intake_filter_defaults.updated": "settings",
  "intent_playbook.updated": "settings",
  "intent_playbook.template_applied": "settings",
  "strategy.created": "crm",
  "strategy.updated": "crm",
  "strategy.deleted": "crm",
  "strategy.assigned": "crm",
  "strategy.pack_imported": "crm",
  "extension.auth_login": "usage",
  "extension.auth_logout": "usage",
  "extension.finding_saved": "usage",
  "role.created": "settings",
  "role.updated": "settings",
  "role.deleted": "settings",
  "role.reset": "settings",
};

export function labelForAuditEvent(event: string): string {
  if (event in AUDIT_EVENT_LABELS) {
    return AUDIT_EVENT_LABELS[event as AuditEvent];
  }
  return event.replace(/\./g, " · ");
}

export function categoryForAuditEvent(event: string): AuditEventCategory {
  if (event in AUDIT_EVENT_CATEGORY) {
    return AUDIT_EVENT_CATEGORY[event as AuditEvent];
  }
  if (event.startsWith("member.") || event.startsWith("invite.")) return "team";
  if (event.startsWith("ai.")) return "ai";
  if (event.startsWith("instantly.")) return "integrations";
  if (event.startsWith("feature.")) return "usage";
  return "crm";
}

/** Client may only append these via POST /api/org/audit/track */
export const CLIENT_TRACKABLE_AUDIT_EVENTS = [
  "feature.page_view",
  "feature.outreach_view",
] as const satisfies readonly AuditEvent[];

export type ClientTrackableAuditEvent = (typeof CLIENT_TRACKABLE_AUDIT_EVENTS)[number];

export const PAGE_PATH_TO_FEATURE: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/leads": "Leads",
  "/prospects": "Prospects",
  "/fit-check": "Fit Check",
  "/pipeline": "Pipeline",
  "/accounts": "Companies",
  "/contacts": "Contacts",
  "/deals": "Deals",
  "/activity": "Activity",
  "/followups": "Followups",
  "/tasks": "Tasks",
  "/scripts": "Scripts",
  "/outreach": "Email outreach",
  "/inbox": "Inbox",
  "/notifications": "Notifications",
  "/team-chat": "Team chat",
  "/admin/ai": "AI admin",
  "/admin/people": "People admin",
  "/admin/team": "People admin",
  "/admin/users": "People admin",
  "/admin/import": "Import",
};

export function featureLabelForPath(pathname: string): string | undefined {
  const base = pathname.split("?")[0] ?? pathname;
  if (PAGE_PATH_TO_FEATURE[base]) return PAGE_PATH_TO_FEATURE[base];
  for (const [prefix, label] of Object.entries(PAGE_PATH_TO_FEATURE)) {
    if (base.startsWith(`${prefix}/`)) return label;
  }
  return undefined;
}
