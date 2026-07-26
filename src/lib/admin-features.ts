import type { OrgMemberRole, Role } from "@/lib/types";

/** Workspace admin capabilities that can be granted per user without changing CRM role. */
export type AdminFeatureKey =
  | "ai_knowledge"
  | "labels"
  | "import"
  | "scrapers"
  | "permissions"
  | "roles"
  | "activity_logs"
  | "organization"
  | "team"
  | "users"
  | "hierarchy"
  | "departments"
  | "channels"
  | "profiles"
  | "email_outreach"
  | "create_campaigns"
  | "delete_intake_pool"
  | "intent_playbook"
  | "buyer_personas"
  | "prospecting_strategies";

export type AdminFeatureMeta = {
  label: string;
  description: string;
  /** Sidebar cluster for grouping in the grants editor. */
  cluster: "programs" | "access" | "company" | "workspace";
  minWorkspaceRole?: Role;
  minOrgRole?: OrgMemberRole;
  href?: string;
};

export const ADMIN_FEATURES: Record<AdminFeatureKey, AdminFeatureMeta> = {
  ai_knowledge: {
    label: "AI & knowledge",
    description: "Org knowledge base, providers, prompts, and usage — shared by Content, Outreach, and Fit Check",
    cluster: "programs",
    minWorkspaceRole: "director",
    minOrgRole: "admin",
    href: "/admin/ai",
  },
  labels: {
    label: "Labels",
    description: "Workspace tags for leads, deals, and companies",
    cluster: "programs",
    href: "/admin/labels",
  },
  import: {
    label: "Import",
    description: "Bulk CSV and spreadsheet import",
    cluster: "programs",
    minWorkspaceRole: "manager",
    minOrgRole: "admin",
    href: "/admin/import",
  },
  scrapers: {
    label: "Scrapers",
    description: "Configure and run intake scraper feeds",
    cluster: "programs",
    minWorkspaceRole: "manager",
    minOrgRole: "manager",
    href: "/admin/scrapers",
  },
  permissions: {
    label: "Person overrides",
    description: "Per-user CRM access exceptions on top of roles",
    cluster: "company",
    minWorkspaceRole: "director",
    href: "/admin/permissions",
  },
  roles: {
    label: "CRM permissions",
    description: "Permission roles, module access, data scope, and sensitive actions",
    cluster: "company",
    minWorkspaceRole: "director",
    minOrgRole: "admin",
    href: "/admin/roles",
  },
  activity_logs: {
    label: "Activity logs",
    description: "Workspace audit and usage history",
    cluster: "access",
    minOrgRole: "admin",
    href: "/admin/logs",
  },
  channels: {
    label: "Channels",
    description: "Pipeline channels and stage configuration",
    cluster: "access",
    minOrgRole: "admin",
    href: "/admin/channels",
  },
  profiles: {
    label: "Profiles",
    description: "Sender profiles for outreach",
    cluster: "access",
    minWorkspaceRole: "team_lead",
    href: "/admin/profiles",
  },
  intent_playbook: {
    label: "Intent playbook",
    description: "Quality scoring signals, weights, and outreach threshold",
    cluster: "programs",
    minWorkspaceRole: "manager",
    minOrgRole: "admin",
    href: "/admin/intent-playbook",
  },
  buyer_personas: {
    label: "Buyer personas",
    description: "ICP buyer personas for prospecting strategies",
    cluster: "programs",
    minWorkspaceRole: "manager",
    minOrgRole: "manager",
    href: "/admin/buyer-personas",
  },
  prospecting_strategies: {
    label: "Strategies",
    description: "Prospecting strategies, assignments, and daily targets",
    cluster: "programs",
    minWorkspaceRole: "manager",
    minOrgRole: "manager",
    href: "/admin/strategies",
  },
  organization: {
    label: "Organization",
    description: "Company profile and workspace settings",
    cluster: "company",
    minWorkspaceRole: "manager",
    minOrgRole: "admin",
    href: "/admin/organization",
  },
  team: {
    label: "People",
    description: "Workspace access, invites, and membership",
    cluster: "company",
    minWorkspaceRole: "manager",
    minOrgRole: "admin",
    href: "/admin/people",
  },
  users: {
    label: "People (CRM profile)",
    description: "CRM permissions, hierarchy, optional teams, and feature access",
    cluster: "company",
    minWorkspaceRole: "manager",
    href: "/admin/people",
  },
  hierarchy: {
    label: "Org hierarchy",
    description: "Reporting lines, managers, and CRM permissions on the chart",
    cluster: "company",
    minWorkspaceRole: "manager",
    href: "/admin/hierarchy",
  },
  departments: {
    label: "Teams",
    description: "Optional reporting groups, targets, and explicit access boundaries",
    cluster: "company",
    minWorkspaceRole: "manager",
    minOrgRole: "admin",
    href: "/admin/teams",
  },
  email_outreach: {
    label: "Email outreach",
    description: "Campaigns and outbound email tools",
    cluster: "workspace",
    minWorkspaceRole: "team_lead",
    href: "/outreach",
  },
  create_campaigns: {
    label: "Create campaigns",
    description: "Create new email outreach campaigns in Instantly",
    cluster: "workspace",
    minOrgRole: "manager",
  },
  delete_intake_pool: {
    label: "Delete intake posts",
    description: "Remove posts from the intake pool (dismiss / bulk delete)",
    cluster: "programs",
    minOrgRole: "admin",
  },
};

/** Features that can be toggled per user (have a role gate someone might not meet). */
export const GRANTABLE_ADMIN_FEATURES: AdminFeatureKey[] = (
  Object.entries(ADMIN_FEATURES) as [AdminFeatureKey, AdminFeatureMeta][]
)
  .filter(([key, m]) => key !== "activity_logs" && (m.minWorkspaceRole != null || m.minOrgRole != null))
  .map(([k]) => k);

export const ADMIN_FEATURE_BY_HREF: Record<string, AdminFeatureKey> = {
  ...Object.fromEntries(
    Object.entries(ADMIN_FEATURES)
      .filter(([, m]) => m.href)
      .map(([k, m]) => [m.href!, k as AdminFeatureKey]),
  ),
  "/admin/departments": "departments",
};

const CLUSTER_ORDER: AdminFeatureMeta["cluster"][] = [
  "programs",
  "access",
  "company",
  "workspace",
];

export function grantableFeaturesByCluster(): {
  cluster: AdminFeatureMeta["cluster"];
  label: string;
  features: AdminFeatureKey[];
}[] {
  const labels: Record<AdminFeatureMeta["cluster"], string> = {
    programs: "Programs & data",
    access: "Access & channels",
    company: "Organization & access",
    workspace: "Workspace",
  };
  return CLUSTER_ORDER.map((cluster) => ({
    cluster,
    label: labels[cluster],
    features: GRANTABLE_ADMIN_FEATURES.filter((k) => ADMIN_FEATURES[k].cluster === cluster),
  })).filter((g) => g.features.length > 0);
}
