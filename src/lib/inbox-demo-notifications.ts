import type { Lead, User } from "@/lib/types";
import type { NotificationPrefKey } from "@/lib/notifications/user-notification-types";

export type NotificationKind =
  | "mention"
  | "assignment"
  | "followup"
  | "idle"
  | "stage"
  | "form"
  | "security";

export interface DemoNotification {
  id: string;
  kind: NotificationKind;
  read: boolean;
  sender: string;
  message: string;
  target: string;
  targetHref: string;
  timestamp: string;
  /** Firestore-backed row - read/dismiss persist across devices. */
  durable?: boolean;
  /** Recipient Settings key that can hide this row. */
  prefKey?: NotificationPrefKey;
}

const DEMO_NOW = new Date();

function ago(minutes: number) {
  return new Date(DEMO_NOW.getTime() - minutes * 60 * 1000).toISOString();
}

function leadById(leads: Lead[], id: string) {
  return leads.find((l) => l.id === id);
}

export function buildDemoNotifications(
  leads: Lead[],
  users: User[],
  viewerUserId: string,
): DemoNotification[] {
  if (leads.length === 0) return [];
  const l1 = leadById(leads, "l-1");
  const l2 = leadById(leads, "l-2");
  const l6 = leadById(leads, "l-6");
  const l7 = leadById(leads, "l-7");
  const l8 = leadById(leads, "l-8");
  const l10 = leadById(leads, "l-10");
  const l15 = leadById(leads, "l-15");
  const l5 = leadById(leads, "l-5");
  const viewer =
    users.find((u) => u.id === viewerUserId) ??
    users.find((u) => u.id === "u-director") ??
    users[0];
  const first = viewer?.displayName.split(" ")[0] ?? "User";
  return [
    {
      id: "n1",
      kind: "mention",
      read: false,
      sender: "u-mgr-email",
      message: `@mentioned you in a note on ${l6?.companyName ?? "Forge Robotics"}`,
      target: l6?.companyName ?? "Forge Robotics",
      targetHref: "/leads/l-6",
      timestamp: ago(8),
    },
    {
      id: "n2",
      kind: "assignment",
      read: false,
      sender: "u-director",
      message: `Lead assigned to you: ${l1?.contactName ?? "Contact"} at ${l1?.companyName ?? "Account"}`,
      target: l1?.contactName ?? "Contact",
      targetHref: "/leads/l-1",
      timestamp: ago(25),
    },
    {
      id: "n3",
      kind: "followup",
      read: false,
      sender: "u-sales-01",
      message: `Followup due today: Send proposal to ${l2?.contactName ?? "Contact"}`,
      target: l2?.contactName ?? "Contact",
      targetHref: "/followups",
      timestamp: ago(60),
    },
    {
      id: "n4",
      kind: "idle",
      read: false,
      sender: "u-director",
      message: `Idle lead alert: ${l8?.companyName ?? "Account"} has been silent for 9 days`,
      target: l8?.companyName ?? "Account",
      targetHref: "/leads/l-8",
      timestamp: ago(120),
    },
    {
      id: "n5",
      kind: "stage",
      read: true,
      sender: "u-sales-02",
      message: "Deal stage changed: Lattice Labs moved to Proposal",
      target: "Lattice Labs",
      targetHref: "/deals",
      timestamp: ago(180),
    },
    {
      id: "n6",
      kind: "form",
      read: true,
      sender: "u-tl-inbound",
      message: "New website form submission from Beacon Health",
      target: "Beacon Health",
      targetHref: "/leads/l-4",
      timestamp: ago(240),
    },
    {
      id: "n7",
      kind: "mention",
      read: false,
      sender: "u-sales-03",
      message: `@mentioned you: 'Can you review the Upwork proposal? @${first.toLowerCase()}'`,
      target: l15?.contactName ?? "Contact",
      targetHref: "/leads/l-15",
      timestamp: ago(300),
    },
    {
      id: "n8",
      kind: "assignment",
      read: true,
      sender: "u-mgr-upwork",
      message: `Lead reassigned from Emma to you: ${l7?.companyName ?? "Account"}`,
      target: l7?.companyName ?? "Account",
      targetHref: "/leads/l-7",
      timestamp: ago(600),
    },
    {
      id: "n9",
      kind: "followup",
      read: true,
      sender: "u-sales-01",
      message: `Overdue followup: Follow up with ${l5?.contactName ?? "Contact"} (3 days past due)`,
      target: l5?.contactName ?? "Contact",
      targetHref: "/followups",
      timestamp: ago(1440),
    },
    {
      id: "n10",
      kind: "idle",
      read: true,
      sender: "u-director",
      message: `Idle alert: ${l10?.companyName ?? "Account"}, 12 days since last touch`,
      target: l10?.companyName ?? "Account",
      targetHref: "/leads/l-10",
      timestamp: ago(2880),
    },
  ];
}
