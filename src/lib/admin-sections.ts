/**
 * Sub-section (tab) metadata for admin/config areas that have deep tabbed views.
 *
 * Keyed by the area's route href. Used by:
 *  - the settings hub (`/admin`) to surface deep links on each card
 *  - the global command palette (⌘K) so users can jump straight to a tab
 *
 * The `tab` value MUST match the `TabsTrigger value` used on the target page,
 * and the target page reads `?tab=` to open on the right section.
 */
export interface AdminSubSection {
  /** Matches the target page's `TabsTrigger value` and the `?tab=` query value. */
  tab: string;
  label: string;
  /** Extra terms to help fuzzy search find this section in the command palette. */
  keywords?: string[];
}

export const ADMIN_SUBSECTIONS: Record<string, AdminSubSection[]> = {
  "/admin/logs": [
    {
      tab: "activity",
      label: "Activity",
      keywords: ["audit", "events", "trail"],
    },
    {
      tab: "errors",
      label: "Error logs",
      keywords: ["exceptions", "failures", "stack", "debug", "request failed"],
    },
  ],
  "/admin/ai": [
    {
      tab: "overview",
      label: "Overview",
      keywords: ["knowledge", "rag", "libraries", "hub", "status"],
    },
    {
      tab: "libraries",
      label: "Libraries",
      keywords: ["rag", "documents", "company", "channel", "topic", "knowledge", "features"],
    },
    {
      tab: "brands",
      label: "Brands",
      keywords: ["content", "voice", "calendar", "capture", "knowledge"],
    },
    {
      tab: "import",
      label: "Import",
      keywords: ["knowledge pack", "prompts pack", "migrate", "upload", "json"],
    },
    { tab: "setup", label: "Setup", keywords: ["provider", "api key", "enable"] },
    {
      tab: "prompts",
      label: "Prompts",
      keywords: ["system prompt", "tone", "content", "outreach"],
    },
    { tab: "usage", label: "Usage", keywords: ["tokens", "cost", "requests"] },
  ],
  "/admin/people": [
    { tab: "members", label: "Members", keywords: ["users", "team", "roles"] },
    { tab: "requests", label: "Pending requests", keywords: ["join", "approve"] },
    { tab: "invites", label: "Pending invites", keywords: ["invite"] },
  ],
  "/settings": [
    { tab: "profile", label: "Profile" },
    { tab: "account", label: "Account", keywords: ["password", "security"] },
    { tab: "notifications", label: "Notifications" },
    { tab: "email", label: "Email" },
    { tab: "integrations", label: "Integrations", keywords: ["webhook", "connect"] },
    { tab: "ai", label: "AI assistant", keywords: ["tone", "assistant"] },
    { tab: "appearance", label: "Appearance", keywords: ["theme", "dark", "light"] },
    {
      tab: "wall",
      label: "Wall display",
      keywords: ["tv", "kiosk", "timer", "carousel", "command board"],
    },
    { tab: "billing", label: "Billing", keywords: ["plan", "subscription", "invoice"] },
  ],
};

/** Build a deep-link href to a specific sub-section tab of an admin area. */
export function adminSubSectionHref(href: string, tab: string): string {
  return `${href}?tab=${encodeURIComponent(tab)}`;
}

/** Valid tab values for an area's page (for validating `?tab=` input). */
export function adminSubSectionTabs(href: string): string[] {
  return (ADMIN_SUBSECTIONS[href] ?? []).map((s) => s.tab);
}
