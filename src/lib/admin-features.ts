import type { OrgMemberRole, Role } from "@/lib/types";

/** Workspace admin capabilities that can be granted per user without changing CRM role. */
export type AdminFeatureKey =
  | "ai_knowledge"
  | "labels"
  | "import"
  | "scrapers"
  | "permissions"
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
  | "delete_intake_pool";

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
    description: "AI settings, prompts, and knowledge libraries",
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
    label: "Permissions",
    description: "CRM record access overrides",
    cluster: "access",
    minWorkspaceRole: "director",
    href: "/admin/permissions",
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
    description: "CRM roles, hierarchy, and feature access",
    cluster: "company",
    minWorkspaceRole: "manager",
    href: "/admin/people",
  },
  hierarchy: {
    label: "Org hierarchy",
    description: "Reporting lines and departments on the chart",
    cluster: "company",
    minWorkspaceRole: "manager",
    href: "/admin/hierarchy",
  },
  departments: {
    label: "Departments",
    description: "Department structure and leads",
    cluster: "company",
    minWorkspaceRole: "manager",
    minOrgRole: "admin",
    href: "/admin/departments",
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

export const ADMIN_FEATURE_BY_HREF: Record<string, AdminFeatureKey> = Object.fromEntries(
  Object.entries(ADMIN_FEATURES)
    .filter(([, m]) => m.href)
    .map(([k, m]) => [m.href!, k as AdminFeatureKey]),
);

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
    company: "Company & team",
    workspace: "Workspace",
  };
  return CLUSTER_ORDER.map((cluster) => ({
    cluster,
    label: labels[cluster],
    features: GRANTABLE_ADMIN_FEATURES.filter((k) => ADMIN_FEATURES[k].cluster === cluster),
  })).filter((g) => g.features.length > 0);
}
