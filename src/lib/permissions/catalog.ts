/**
 * Nova Role Catalog - complete ModuleKey + ActionKey surface.
 * Used by role presets, the Roles editor UI, and the permission resolver.
 */

export type ModuleCapability = "view" | "create" | "edit" | "delete";

export type DataScope = "none" | "own" | "team" | "department" | "all";

export type ModuleCluster =
  | "workspace"
  | "company"
  | "access"
  | "programs"
  | "personal";

/** Layer A - modules with CRUD + data scope. */
export type ModuleKey =
  | "dashboard"
  | "leads"
  | "prospects"
  | "my_strategy"
  | "intake"
  | "fit_check"
  | "pipeline"
  | "accounts"
  | "contacts"
  | "deals"
  | "followups"
  | "scheduling"
  | "tasks"
  | "content_calendar"
  | "scripts"
  | "email_outreach"
  | "inbox"
  | "notifications"
  | "team_chat"
  | "activity"
  | "organization"
  | "people"
  | "hierarchy"
  | "roles"
  | "permissions"
  | "activity_logs"
  | "departments"
  | "channels"
  | "profiles"
  | "ai_knowledge"
  | "labels"
  | "intent_playbook"
  | "prospecting_strategies"
  | "buyer_personas"
  | "import"
  | "scrapers"
  | "settings_self";

export type ModulePermission = {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  scope: DataScope;
};

export type ModuleMeta = {
  label: string;
  description: string;
  cluster: ModuleCluster;
  /** When true, create/edit/delete are typically N/A (view-only modules). */
  viewOnly?: boolean;
  href?: string;
};

export const MODULE_META: Record<ModuleKey, ModuleMeta> = {
  dashboard: {
    label: "Dashboard",
    description: "Workspace dashboard and wall",
    cluster: "workspace",
    viewOnly: true,
    href: "/dashboard",
  },
  leads: {
    label: "Leads",
    description: "Sales leads list and detail",
    cluster: "workspace",
    href: "/leads",
  },
  prospects: {
    label: "Prospects",
    description: "Top-of-funnel prospects",
    cluster: "workspace",
    href: "/prospects",
  },
  my_strategy: {
    label: "My Strategy",
    description: "Assigned prospecting strategy progress",
    cluster: "workspace",
    viewOnly: true,
    href: "/my-strategy",
  },
  intake: {
    label: "Intake pool",
    description: "Scraper / intake staging pool",
    cluster: "workspace",
    href: "/intake",
  },
  fit_check: {
    label: "Fit Check",
    description: "Opportunity fit analysis",
    cluster: "workspace",
    viewOnly: true,
    href: "/fit-check",
  },
  pipeline: {
    label: "Pipeline",
    description: "Kanban pipeline board",
    cluster: "workspace",
    href: "/pipeline",
  },
  accounts: {
    label: "Companies",
    description: "Account / company records",
    cluster: "workspace",
    href: "/accounts",
  },
  contacts: {
    label: "Contacts",
    description: "Contact records",
    cluster: "workspace",
    href: "/contacts",
  },
  deals: {
    label: "Deals",
    description: "Deal records",
    cluster: "workspace",
    href: "/deals",
  },
  followups: {
    label: "Followups",
    description: "Follow-up queue",
    cluster: "workspace",
    href: "/followups",
  },
  scheduling: {
    label: "Scheduling",
    description: "Links, meetings, availability",
    cluster: "workspace",
    href: "/scheduling",
  },
  tasks: {
    label: "Tasks",
    description: "Lead tasks",
    cluster: "workspace",
    href: "/tasks",
  },
  content_calendar: {
    label: "Content",
    description: "Social content calendar, brands, and captures",
    cluster: "workspace",
    href: "/content",
  },
  scripts: {
    label: "Scripts",
    description: "Script library",
    cluster: "workspace",
    href: "/scripts",
  },
  email_outreach: {
    label: "Email outreach",
    description: "Campaigns and outbound email",
    cluster: "workspace",
    href: "/outreach",
  },
  inbox: {
    label: "Inbox",
    description: "Workspace notifications inbox",
    cluster: "workspace",
    viewOnly: true,
    href: "/inbox",
  },
  notifications: {
    label: "Notifications",
    description: "Notification center",
    cluster: "workspace",
    viewOnly: true,
    href: "/notifications",
  },
  team_chat: {
    label: "Team chat",
    description: "Internal team chat",
    cluster: "workspace",
    href: "/team-chat",
  },
  activity: {
    label: "Activity",
    description: "Retired daily rollups (redirects to dashboard)",
    cluster: "workspace",
    viewOnly: true,
    href: "/activity",
  },
  organization: {
    label: "Organization",
    description: "Company profile and workspace settings",
    cluster: "company",
    href: "/admin/organization",
  },
  people: {
    label: "People",
    description: "Members, invites, and CRM profiles",
    cluster: "company",
    href: "/admin/people",
  },
  hierarchy: {
    label: "Org hierarchy",
    description: "Reporting lines chart",
    cluster: "company",
    href: "/admin/hierarchy",
  },
  roles: {
    label: "CRM permissions",
    description: "Permission roles, module access, and data boundaries",
    cluster: "company",
    href: "/admin/roles",
  },
  permissions: {
    label: "Person overrides",
    description: "Per-user permission exceptions",
    cluster: "company",
    href: "/admin/permissions",
  },
  activity_logs: {
    label: "Activity logs",
    description: "Workspace audit history",
    cluster: "access",
    viewOnly: true,
    href: "/admin/logs",
  },
  departments: {
    label: "Teams",
    description: "Optional reporting and access groups",
    cluster: "company",
    href: "/admin/teams",
  },
  channels: {
    label: "Channels",
    description: "Pipeline channels and stages",
    cluster: "access",
    href: "/admin/channels",
  },
  profiles: {
    label: "Profiles",
    description: "Sender profiles for outreach",
    cluster: "access",
    href: "/admin/profiles",
  },
  ai_knowledge: {
    label: "AI & knowledge",
    description: "AI settings, prompts, and libraries",
    cluster: "programs",
    href: "/admin/ai",
  },
  labels: {
    label: "Labels",
    description: "Workspace tags",
    cluster: "programs",
    href: "/admin/labels",
  },
  intent_playbook: {
    label: "Intent playbook",
    description: "Quality scoring signals",
    cluster: "programs",
    href: "/admin/intent-playbook",
  },
  prospecting_strategies: {
    label: "Strategies",
    description: "Prospecting strategies and assignments",
    cluster: "programs",
    href: "/admin/strategies",
  },
  buyer_personas: {
    label: "Buyer personas",
    description: "ICP buyer personas",
    cluster: "programs",
    href: "/admin/buyer-personas",
  },
  import: {
    label: "Import",
    description: "Bulk CSV / spreadsheet import",
    cluster: "programs",
    href: "/admin/import",
  },
  scrapers: {
    label: "Scrapers",
    description: "Intake scraper feeds",
    cluster: "programs",
    href: "/admin/scrapers",
  },
  settings_self: {
    label: "Settings",
    description: "Personal account settings",
    cluster: "personal",
    href: "/settings",
  },
};

export const MODULE_KEYS = Object.keys(MODULE_META) as ModuleKey[];

export const MODULE_CLUSTER_LABELS: Record<ModuleCluster, string> = {
  workspace: "Workspace",
  company: "Organization & access",
  access: "Access & channels",
  programs: "Programs & data",
  personal: "Personal",
};

export const MODULE_CLUSTER_ORDER: ModuleCluster[] = [
  "workspace",
  "company",
  "access",
  "programs",
  "personal",
];

/** Layer B - sensitive action flags. */
export type ActionKey =
  | "leads.reassign"
  | "leads.archive"
  | "leads.export"
  | "leads.bulk_edit"
  | "leads.change_stage"
  | "leads.log_touchpoint"
  | "leads.ai_suggest"
  | "leads.manage_labels"
  | "prospects.assign_channels"
  | "prospects.push_to_lead"
  | "prospects.move_back_to_prospect"
  | "prospects.edit_sourced"
  | "prospects.promote_from_intake"
  | "intake.delete_posts"
  | "intake.bulk_dismiss"
  | "intake.configure_filters"
  | "deals.change_stage"
  | "deals.export"
  | "accounts.merge"
  | "contacts.merge"
  | "outreach.create_campaign"
  | "outreach.edit_campaign"
  | "outreach.delete_campaign"
  | "outreach.send_test"
  | "mailbox.view_others"
  | "mailbox.send_as_other"
  | "scheduling.manage_org_links"
  | "scheduling.delegate_calendar"
  | "team_chat.manage_channels"
  | "notifications.broadcast"
  | "dashboard.view_team_ops"
  | "dashboard.view_mailbox_utilization"
  | "dashboard.preview_as_role"
  | "dashboard.export"
  | "people.invite"
  | "people.disable"
  | "people.edit_crm_role"
  | "people.edit_feature_grants"
  | "people.edit_hierarchy"
  | "roles.manage"
  | "permissions.manage_overrides"
  | "strategies.assign_users"
  | "strategies.edit_targets"
  | "scrapers.run"
  | "scrapers.edit_feeds"
  | "import.run"
  | "ai.manage_providers"
  | "ai.manage_knowledge"
  | "ai.view_usage"
  | "organization.edit"
  | "organization.billing"
  | "audit.export";

export type ActionGroup =
  | "leads_prospects"
  | "deals_crm"
  | "outreach"
  | "scheduling_chat"
  | "dashboard"
  | "people_access"
  | "programs"
  | "danger";

export type ActionMeta = {
  label: string;
  description: string;
  group: ActionGroup;
};

export const ACTION_META: Record<ActionKey, ActionMeta> = {
  "leads.reassign": {
    label: "Reassign leads",
    description: "Change lead owner / assignee",
    group: "leads_prospects",
  },
  "leads.archive": {
    label: "Delete leads",
    description: "Permanently delete leads from the workspace (no undo)",
    group: "danger",
  },
  "leads.export": {
    label: "Export leads",
    description: "Export lead lists to CSV",
    group: "leads_prospects",
  },
  "leads.bulk_edit": {
    label: "Bulk edit leads",
    description: "Multi-select field updates",
    group: "leads_prospects",
  },
  "leads.change_stage": {
    label: "Change lead stage",
    description: "Move leads through pipeline stages",
    group: "leads_prospects",
  },
  "leads.log_touchpoint": {
    label: "Log touchpoints",
    description: "Record outreach touchpoints",
    group: "leads_prospects",
  },
  "leads.ai_suggest": {
    label: "AI lead suggestions",
    description: "Use AI follow-up / intent suggestions",
    group: "leads_prospects",
  },
  "leads.manage_labels": {
    label: "Manage lead labels",
    description: "Apply and remove CRM labels on leads",
    group: "leads_prospects",
  },
  "prospects.assign_channels": {
    label: "Assign prospect channels",
    description: "Assign channels and owners on prospects",
    group: "leads_prospects",
  },
  "prospects.push_to_lead": {
    label: "Push prospect to lead",
    description: "Promote a prospect into a sales lead",
    group: "leads_prospects",
  },
  "prospects.move_back_to_prospect": {
    label: "Move lead back to prospect",
    description: "Undo an accidental promote or channel push back to prospect intake",
    group: "leads_prospects",
  },
  "prospects.edit_sourced": {
    label: "Edit sourced prospects",
    description: "Edit prospects the user sourced",
    group: "leads_prospects",
  },
  "prospects.promote_from_intake": {
    label: "Promote from intake",
    description: "Promote intake items to prospects/leads",
    group: "leads_prospects",
  },
  "intake.delete_posts": {
    label: "Delete intake posts",
    description: "Remove posts from the intake pool",
    group: "leads_prospects",
  },
  "intake.bulk_dismiss": {
    label: "Bulk dismiss intake",
    description: "Dismiss many intake items at once",
    group: "leads_prospects",
  },
  "intake.configure_filters": {
    label: "Configure intake filters",
    description: "Edit org-wide intake keyword defaults",
    group: "leads_prospects",
  },
  "deals.change_stage": {
    label: "Change deal stage",
    description: "Move deals through stages",
    group: "deals_crm",
  },
  "deals.export": {
    label: "Export deals",
    description: "Export deal lists",
    group: "deals_crm",
  },
  "accounts.merge": {
    label: "Merge companies",
    description: "Merge duplicate company records",
    group: "deals_crm",
  },
  "contacts.merge": {
    label: "Merge contacts",
    description: "Merge duplicate contacts",
    group: "deals_crm",
  },
  "outreach.create_campaign": {
    label: "Create campaigns",
    description: "Create email outreach campaigns",
    group: "outreach",
  },
  "outreach.edit_campaign": {
    label: "Edit campaigns",
    description: "Edit existing campaigns",
    group: "outreach",
  },
  "outreach.delete_campaign": {
    label: "Delete campaigns",
    description: "Delete outreach campaigns",
    group: "outreach",
  },
  "outreach.send_test": {
    label: "Send test emails",
    description: "Send campaign test emails",
    group: "outreach",
  },
  "mailbox.view_others": {
    label: "View other mailboxes",
    description: "Open team member mailboxes",
    group: "outreach",
  },
  "mailbox.send_as_other": {
    label: "Send as other",
    description: "Send mail from another member's mailbox",
    group: "outreach",
  },
  "scheduling.manage_org_links": {
    label: "Manage org scheduling links",
    description: "Create and edit org-wide booking links",
    group: "scheduling_chat",
  },
  "scheduling.delegate_calendar": {
    label: "Delegate calendars",
    description: "Grant calendar booking delegations",
    group: "scheduling_chat",
  },
  "team_chat.manage_channels": {
    label: "Manage chat channels",
    description: "Create and administer team chat channels",
    group: "scheduling_chat",
  },
  "notifications.broadcast": {
    label: "Broadcast notifications",
    description: "Send workspace-wide notifications",
    group: "scheduling_chat",
  },
  "dashboard.view_team_ops": {
    label: "View team ops board",
    description: "See team-level dashboard ops analytics",
    group: "dashboard",
  },
  "dashboard.view_mailbox_utilization": {
    label: "View mailbox utilization",
    description: "See org-wide mailbox utilization on the ops dashboard (salespeople always see their own assigned inboxes)",
    group: "dashboard",
  },
  "dashboard.preview_as_role": {
    label: "Preview as permission role",
    description: "Preview the dashboard using another CRM permission role",
    group: "dashboard",
  },
  "dashboard.export": {
    label: "Export dashboard",
    description: "Export dashboard reports",
    group: "dashboard",
  },
  "people.invite": {
    label: "Invite people",
    description: "Invite members to the workspace",
    group: "people_access",
  },
  "people.disable": {
    label: "Disable people",
    description: "Disable workspace members",
    group: "people_access",
  },
  "people.edit_crm_role": {
    label: "Edit CRM permissions",
    description: "Assign CRM permission roles to members",
    group: "people_access",
  },
  "people.edit_feature_grants": {
    label: "Edit feature grants",
    description: "Assign per-user feature extras",
    group: "people_access",
  },
  "people.edit_hierarchy": {
    label: "Edit hierarchy",
    description: "Change reporting lines and optional team membership",
    group: "people_access",
  },
  "roles.manage": {
    label: "Manage CRM permissions",
    description: "Create and edit CRM permission roles",
    group: "people_access",
  },
  "permissions.manage_overrides": {
    label: "Manage person overrides",
    description: "Create grant/deny permission overrides",
    group: "people_access",
  },
  "strategies.assign_users": {
    label: "Assign strategies",
    description: "Assign people to prospecting strategies",
    group: "programs",
  },
  "strategies.edit_targets": {
    label: "Edit strategy targets",
    description: "Edit daily targets on strategies",
    group: "programs",
  },
  "scrapers.run": {
    label: "Run scrapers",
    description: "Trigger scraper feed runs",
    group: "programs",
  },
  "scrapers.edit_feeds": {
    label: "Edit scraper feeds",
    description: "Configure scraper feed definitions",
    group: "programs",
  },
  "import.run": {
    label: "Run imports",
    description: "Start bulk import jobs",
    group: "programs",
  },
  "ai.manage_providers": {
    label: "Manage AI providers",
    description: "Configure AI provider keys and setup",
    group: "programs",
  },
  "ai.manage_knowledge": {
    label: "Manage AI knowledge",
    description: "Edit AI knowledge libraries and documents",
    group: "programs",
  },
  "ai.view_usage": {
    label: "View AI usage",
    description: "See AI token/cost usage",
    group: "programs",
  },
  "organization.edit": {
    label: "Edit organization",
    description: "Change org name and workspace settings",
    group: "danger",
  },
  "organization.billing": {
    label: "Manage billing",
    description: "Access billing and plan settings",
    group: "danger",
  },
  "audit.export": {
    label: "Export audit logs",
    description: "Export workspace audit history",
    group: "danger",
  },
};

export const ACTION_KEYS = Object.keys(ACTION_META) as ActionKey[];

export const ACTION_GROUP_LABELS: Record<ActionGroup, string> = {
  leads_prospects: "Leads & prospects",
  deals_crm: "Deals & CRM records",
  outreach: "Outreach & email",
  scheduling_chat: "Scheduling, chat & notifications",
  dashboard: "Dashboard & analytics",
  people_access: "People & access",
  programs: "Programs & data",
  danger: "Danger / tenant",
};

export const ACTION_GROUP_ORDER: ActionGroup[] = [
  "leads_prospects",
  "deals_crm",
  "outreach",
  "scheduling_chat",
  "dashboard",
  "people_access",
  "programs",
  "danger",
];

export const DATA_SCOPE_OPTIONS: { value: DataScope; label: string }[] = [
  { value: "none", label: "None" },
  { value: "own", label: "Own" },
  { value: "team", label: "Reporting team" },
  { value: "all", label: "Everyone" },
];

export function emptyModulePermission(scope: DataScope = "none"): ModulePermission {
  return {
    view: false,
    create: false,
    edit: false,
    delete: false,
    scope,
  };
}

export function modulePermission(
  opts: Partial<ModulePermission> & { view?: boolean },
): ModulePermission {
  const view = opts.view ?? false;
  return {
    view,
    create: opts.create ?? false,
    edit: opts.edit ?? false,
    delete: opts.delete ?? false,
    scope: opts.scope ?? (view ? "own" : "none"),
  };
}

/** Map admin feature keys / nav hrefs onto catalog modules. */
export const MODULE_BY_HREF: Record<string, ModuleKey> = {
  ...Object.fromEntries(
    Object.entries(MODULE_META)
      .filter(([, m]) => m.href)
      .map(([k, m]) => [m.href!, k as ModuleKey]),
  ),
  "/admin/departments": "departments",
  "/dashboard/reply-intelligence": "dashboard",
  "/replies": "leads",
  "/archive": "leads",
};

export function modulesByCluster(): {
  cluster: ModuleCluster;
  label: string;
  modules: ModuleKey[];
}[] {
  return MODULE_CLUSTER_ORDER.map((cluster) => ({
    cluster,
    label: MODULE_CLUSTER_LABELS[cluster],
    modules: MODULE_KEYS.filter((k) => MODULE_META[k].cluster === cluster),
  }));
}

export function actionsByGroup(): {
  group: ActionGroup;
  label: string;
  actions: ActionKey[];
}[] {
  return ACTION_GROUP_ORDER.map((group) => ({
    group,
    label: ACTION_GROUP_LABELS[group],
    actions: ACTION_KEYS.filter((k) => ACTION_META[k].group === group),
  }));
}
