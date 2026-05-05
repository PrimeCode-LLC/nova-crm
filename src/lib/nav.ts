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
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Workspace",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/leads", label: "Leads", icon: Target },
      { href: "/pipeline", label: "Pipeline", icon: Kanban },
      { href: "/accounts", label: "Accounts", icon: Building2 },
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
      { href: "/admin/organization", label: "Organization", icon: Building2 },
      { href: "/admin/team", label: "Team", icon: UsersRound },
      { href: "/admin/users", label: "Users (demo)", icon: Users },
      { href: "/admin/permissions", label: "Permissions", icon: Shield },
      { href: "/admin/departments", label: "Departments", icon: UserCog },
      { href: "/admin/channels", label: "Channels", icon: Radio },
      { href: "/admin/profiles", label: "Profiles", icon: FileText },
      { href: "/admin/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/admin/import", label: "Import", icon: UploadCloud },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export const FLAT_NAV: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);
