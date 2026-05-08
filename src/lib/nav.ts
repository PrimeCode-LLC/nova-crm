import {
  LayoutDashboard,
  Users,
  Building2,
  Contact2,
  Target,
  Kanban,
  Activity,
  CalendarClock,
  ListTodo,
  Inbox,
  Settings,
  Shield,
  UploadCloud,
  UserCog,
  FileText,
  FileCode2,
  Megaphone,
  Radio,
  BarChart3,
  Tag,
  UsersRound,
  Network,
  ScanSearch,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/lib/types";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  /**
   * Lowest CRM workspace role that may see this link (OrgMemberRole is separate).
   * Omitted = visible to everyone who can open the app.
   */
  minWorkspaceRole?: Role;
  /** Only used for items under the Configuration section — drives sidebar clusters. */
  adminCluster?: AdminNavClusterId;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export type AdminNavClusterId = "company" | "access" | "programs" | "personal";

export const ADMIN_CLUSTER_META: Record<
  AdminNavClusterId,
  { label: string; order: number }
> = {
  company: { label: "Company & team", order: 0 },
  access: { label: "Access & channels", order: 1 },
  programs: { label: "Programs & data", order: 2 },
  personal: { label: "Personal", order: 3 },
};

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Workspace",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/leads", label: "Leads", icon: Target },
      { href: "/prospects", label: "Prospects", icon: ScanSearch },
      { href: "/pipeline", label: "Pipeline", icon: Kanban },
      { href: "/accounts", label: "Companies", icon: Building2 },
      { href: "/contacts", label: "Contacts", icon: Contact2 },
      { href: "/deals", label: "Deals", icon: BarChart3 },
      { href: "/activity", label: "Activity", icon: Activity },
      { href: "/followups", label: "Followups", icon: CalendarClock },
      { href: "/tasks", label: "Tasks", icon: ListTodo },
      { href: "/scripts", label: "Scripts", icon: FileCode2 },
      { href: "/inbox", label: "Inbox", icon: Inbox },
    ],
  },
  {
    label: "Configuration",
    items: [
      {
        href: "/admin/organization",
        label: "Organization",
        icon: Building2,
        minWorkspaceRole: "manager",
        adminCluster: "company",
      },
      {
        href: "/admin/team",
        label: "Team",
        icon: UsersRound,
        minWorkspaceRole: "manager",
        adminCluster: "company",
      },
      {
        href: "/admin/users",
        label: "Users (demo)",
        icon: Users,
        minWorkspaceRole: "manager",
        adminCluster: "company",
      },
      {
        href: "/admin/hierarchy",
        label: "Org hierarchy",
        icon: Network,
        minWorkspaceRole: "manager",
        adminCluster: "company",
      },
      {
        href: "/admin/permissions",
        label: "Permissions",
        icon: Shield,
        minWorkspaceRole: "director",
        adminCluster: "access",
      },
      {
        href: "/admin/departments",
        label: "Departments",
        icon: UserCog,
        minWorkspaceRole: "manager",
        adminCluster: "company",
      },
      {
        href: "/admin/channels",
        label: "Channels",
        icon: Radio,
        minWorkspaceRole: "team_lead",
        adminCluster: "access",
      },
      {
        href: "/admin/profiles",
        label: "Profiles",
        icon: FileText,
        minWorkspaceRole: "team_lead",
        adminCluster: "access",
      },
      {
        href: "/admin/campaigns",
        label: "Campaigns",
        icon: Megaphone,
        minWorkspaceRole: "team_lead",
        adminCluster: "programs",
      },
      {
        href: "/admin/labels",
        label: "Labels",
        icon: Tag,
        minWorkspaceRole: "manager",
        adminCluster: "programs",
      },
      {
        href: "/admin/import",
        label: "Import",
        icon: UploadCloud,
        minWorkspaceRole: "manager",
        adminCluster: "programs",
      },
      {
        href: "/settings",
        label: "Settings",
        icon: Settings,
        adminCluster: "personal",
      },
    ],
  },
];

const WORKSPACE_ROLE_RANK: Record<Role, number> = {
  director: 40,
  manager: 30,
  team_lead: 20,
  salesperson: 10,
  data_scraper: 10,
  prospecting: 10,
};

export type NavAccessContext = {
  roleId: Role | undefined;
  isSuperAdmin: boolean;
  /** When true, do not hide elevated links while the user profile is still loading. */
  roleLoading?: boolean;
};

export function canAccessNavItem(item: NavItem, ctx: NavAccessContext): boolean {
  if (ctx.isSuperAdmin) return true;
  if (!item.minWorkspaceRole) return true;
  if (ctx.roleLoading && ctx.roleId === undefined) return true;
  const role = ctx.roleId ?? "salesperson";
  return WORKSPACE_ROLE_RANK[role] >= WORKSPACE_ROLE_RANK[item.minWorkspaceRole];
}

export function getVisibleNavSections(ctx: NavAccessContext): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canAccessNavItem(item, ctx)),
  })).filter((section) => section.items.length > 0);
}

export function findNavItemByHref(href: string): NavItem | undefined {
  for (const section of NAV_SECTIONS) {
    const hit = section.items.find((item) => item.href === href);
    if (hit) return hit;
  }
  return undefined;
}

export function clusterConfigurationItems(items: NavItem[]): {
  clusterId: AdminNavClusterId;
  label: string;
  items: NavItem[];
}[] {
  const byCluster = new Map<AdminNavClusterId, NavItem[]>();
  for (const item of items) {
    const cid = item.adminCluster;
    if (!cid) continue;
    const list = byCluster.get(cid) ?? [];
    list.push(item);
    byCluster.set(cid, list);
  }
  return (Object.keys(ADMIN_CLUSTER_META) as AdminNavClusterId[])
    .map((clusterId) => ({
      clusterId,
      label: ADMIN_CLUSTER_META[clusterId].label,
      items: byCluster.get(clusterId) ?? [],
    }))
    .filter((g) => g.items.length > 0);
}

export const FLAT_NAV: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);
