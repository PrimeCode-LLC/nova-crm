import { mockUsers, CURRENT_USER_ID } from "./mock-data";

export const DEMO_PERSONA_COOKIE = "nova_demo_persona";

/** Match workspace cookie lifetime. */
export const DEMO_PERSONA_MAX_AGE = 60 * 60 * 24 * 365;

export type DemoRolePreset = {
  userId: string;
  title: string;
  subtitle: string;
  /** What to notice in Admin → Permissions & own data. */
  permissionHint: string;
};

/** Curated order for onboarding; every `mockUsers` entry should appear once. */
export const DEMO_ROLE_PRESETS: DemoRolePreset[] = [
  {
    userId: "u-director",
    title: "Founder & Director",
    subtitle: "Full org view, owns LinkedIn + Upwork exec profiles.",
    permissionHint: "Sees all teams; use for org-wide settings and overrides.",
  },
  {
    userId: "u-mgr-email",
    title: "Outbound Manager",
    subtitle: "Manages SDRs and data researchers on cold email + LinkedIn.",
    permissionHint: "Grant/deny examples on sales users; mentors pipeline.",
  },
  {
    userId: "u-mgr-upwork",
    title: "Upwork Team Lead",
    subtitle: "Owns Upwork profiles and closers.",
    permissionHint: "Good for Upwork + reassignment flows in inbox demo.",
  },
  {
    userId: "u-sales-01",
    title: "Senior SDR",
    subtitle: "Outbound quota, lead ownership, followups.",
    permissionHint: "Try leads table, followups, and permission note tied to this user.",
  },
  {
    userId: "u-sales-02",
    title: "SDR",
    subtitle: "Standard rep; appears in PIP-style deny example.",
    permissionHint: "Open Admin → Users → this user for override + activity.",
  },
  {
    userId: "u-sales-03",
    title: "Upwork Closer",
    subtitle: "Job-apply CVs + Upwork channel.",
    permissionHint: "Mentions director in inbox demo; deals on Upwork leads.",
  },
  {
    userId: "u-scrape-01",
    title: "Prospecting & data",
    subtitle: "Adds intake prospects; New prospect form or Quick add Lead tags you as Lead by.",
    permissionHint: "Intake card on lead detail; promote when replies show interest.",
  },
  {
    userId: "u-tl-inbound",
    title: "Inbound Lead",
    subtitle: "Website forms and 1:1 followups.",
    permissionHint: "Inbox form notifications; inbound slice of dashboard.",
  },
];

export function parseDemoPersonaId(value: string | undefined): string {
  if (!value) return CURRENT_USER_ID;
  return mockUsers.some((u) => u.id === value) ? value : CURRENT_USER_ID;
}
