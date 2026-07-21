import {
  LayoutDashboard,
  Users,
  Building2,
  Contact2,
  Target,
  Kanban,
  CalendarClock,
  CalendarDays,
  ListTodo,
  Inbox,
  Bell,
  MessagesSquare,
  Settings,
  Shield,
  UploadCloud,
  UserCog,
  FileText,
  FileCode2,
  Mail,
  Radio,
  BarChart3,
  Tag,
  UsersRound,
  Network,
  ScanSearch,
  Rss,
  Sparkles,
  ScrollText,
  Crosshair,
  BookOpen,
  UserCircle2,
  type LucideIcon,
} from "lucide-react";

import type { AdminFeatureKey } from "@/lib/admin-features";
import { userHasAdminFeature, workspaceRoleMeetsMin } from "@/lib/admin-feature-access";
import { MODULE_BY_HREF } from "@/lib/permissions/catalog";
import { canAccessHref } from "@/lib/permissions/can";
import type { EffectivePermissionSnapshot } from "@/lib/permissions/role-types";
import type { OrgMemberRole, Role } from "@/lib/types";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  /**
   * Lowest CRM workspace role that may see this link (OrgMemberRole is separate).
   * Omitted = visible to everyone who can open the app unless `adminFeature` is set.
   */
  minWorkspaceRole?: Role;
  /** When set, access also follows per-user grants (`User.featureGrants`). */
  adminFeature?: AdminFeatureKey;
  /** Visible if the user has any listed admin feature grant or role gate. */
  adminFeatures?: AdminFeatureKey[];
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
  company: { label: "Organization & access", order: 0 },
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
      { href: "/my-strategy", label: "My Strategy", icon: BookOpen },
      { href: "/intake", label: "Intake pool", icon: Rss },
      { href: "/fit-check", label: "Fit Check", icon: Sparkles },
      { href: "/pipeline", label: "Pipeline", icon: Kanban },
      { href: "/accounts", label: "Companies", icon: Building2 },
      { href: "/contacts", label: "Contacts", icon: Contact2 },
      { href: "/deals", label: "Deals", icon: BarChart3 },
      { href: "/followups", label: "Followups", icon: CalendarClock },
      { href: "/scheduling", label: "Scheduling", icon: CalendarDays },
      { href: "/tasks", label: "Tasks", icon: ListTodo },
      { href: "/scripts", label: "Scripts", icon: FileCode2 },
      {
        href: "/outreach",
        label: "Email outreach",
        icon: Mail,
        minWorkspaceRole: "team_lead",
        adminFeature: "email_outreach",
      },
      { href: "/inbox", label: "Inbox", icon: Inbox },
      { href: "/notifications", label: "Notifications", icon: Bell },
      { href: "/team-chat", label: "Team chat", icon: MessagesSquare },
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
        adminFeature: "organization",
        adminCluster: "company",
      },
      {
        href: "/admin/people",
        label: "People",
        icon: UsersRound,
        minWorkspaceRole: "manager",
        adminFeatures: ["team", "users"],
        adminCluster: "company",
      },
      {
        href: "/admin/hierarchy",
        label: "Org hierarchy",
        icon: Network,
        minWorkspaceRole: "manager",
        adminFeature: "hierarchy",
        adminCluster: "company",
      },
      {
        href: "/admin/permissions",
        label: "Person overrides",
        icon: Shield,
        minWorkspaceRole: "director",
        adminFeature: "permissions",
        adminCluster: "company",
      },
      {
        href: "/admin/roles",
        label: "CRM permissions",
        icon: UserCog,
        minWorkspaceRole: "director",
        adminFeature: "roles",
        adminCluster: "company",
      },
      {
        href: "/admin/logs",
        label: "Activity logs",
        icon: ScrollText,
        adminFeature: "activity_logs",
        adminCluster: "access",
      },
      {
        href: "/admin/teams",
        label: "Teams",
        icon: Users,
        minWorkspaceRole: "manager",
        adminFeature: "departments",
        adminCluster: "company",
      },
      {
        href: "/admin/channels",
        label: "Channels",
        icon: Radio,
        adminFeature: "channels",
        adminCluster: "access",
      },
      {
        href: "/admin/profiles",
        label: "Profiles",
        icon: FileText,
        minWorkspaceRole: "team_lead",
        adminFeature: "profiles",
        adminCluster: "access",
      },
      {
        href: "/admin/ai",
        label: "AI & knowledge",
        icon: Sparkles,
        minWorkspaceRole: "director",
        adminFeature: "ai_knowledge",
        adminCluster: "programs",
      },
      {
        href: "/admin/labels",
        label: "Labels",
        icon: Tag,
        adminFeature: "labels",
        adminCluster: "programs",
      },
      {
        href: "/admin/intent-playbook",
        label: "Intent playbook",
        icon: Crosshair,
        minWorkspaceRole: "manager",
        adminFeature: "intent_playbook",
        adminCluster: "programs",
      },
      {
        href: "/admin/strategies",
        label: "Strategies",
        icon: Target,
        minWorkspaceRole: "manager",
        adminFeature: "prospecting_strategies",
        adminCluster: "programs",
      },
      {
        href: "/admin/buyer-personas",
        label: "Buyer personas",
        icon: UserCircle2,
        minWorkspaceRole: "manager",
        adminFeature: "buyer_personas",
        adminCluster: "programs",
      },
      {
        href: "/admin/import",
        label: "Import",
        icon: UploadCloud,
        minWorkspaceRole: "manager",
        adminFeature: "import",
        adminCluster: "programs",
      },
      {
        href: "/admin/scrapers",
        label: "Scrapers",
        icon: Rss,
        minWorkspaceRole: "manager",
        adminFeature: "scrapers",
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

export type NavAccessContext = {
  roleId: Role | undefined;
  orgRole?: OrgMemberRole;
  isSuperAdmin: boolean;
  featureGrants?: import("@/lib/types").User["featureGrants"];
  /**
   * Effective modules/actions from `computedPermissions/{uid}` (Roles catalog).
   * When set, admin features and module hrefs honor the catalog instead of legacy role gates only.
   */
  roleSnapshot?: EffectivePermissionSnapshot | null;
  /** When true, do not hide elevated links while the user profile / permissions are still loading. */
  roleLoading?: boolean;
};

export function canAccessNavItem(item: NavItem, ctx: NavAccessContext): boolean {
  // Keep nav stable until profile + computed permissions settle (avoids flash show/hide).
  if (ctx.roleLoading) return true;

  const subject = {
    roleId: ctx.roleId ?? "salesperson",
    isSuperAdmin: ctx.isSuperAdmin,
    featureGrants: ctx.featureGrants,
    orgRole: ctx.orgRole,
    roleSnapshot: ctx.roleSnapshot,
  };
  const featureKeys =
    item.adminFeatures?.length ? item.adminFeatures : item.adminFeature ? [item.adminFeature] : [];
  if (featureKeys.length > 0) {
    return featureKeys.some((key) => userHasAdminFeature(subject, key, ctx.orgRole));
  }
  if (ctx.isSuperAdmin) return true;
  // Honor Roles catalog module toggles (e.g. Intake pool) once computed permissions are loaded.
  if (ctx.roleSnapshot && MODULE_BY_HREF[item.href]) {
    return canAccessHref(subject, item.href);
  }
  if (!item.minWorkspaceRole) return true;
  return workspaceRoleMeetsMin(ctx.roleId, item.minWorkspaceRole);
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
