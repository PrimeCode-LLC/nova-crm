/**
 * Marketing-site config. Read once, used by metadata, sitemap, and robots.
 * Override the URL with NEXT_PUBLIC_SITE_URL in production.
 */
export const SITE = {
  name: "Nova",
  /** Short product identity for wordmarks */
  productName: "Nova",
  tagline: "Every Prospect Journey, Intelligently Managed.",
  description:
    "Nova is an AI revenue execution system that understands each prospect, personalizes outreach, manages follow-ups, interprets replies, and advances every journey from first contact to final outcome.",
  oneLiner:
    "An intelligent prospect management system that understands, manages, and automates every prospect journey.",
  salesEmail: "sales@stellixsoft.com",
  url:
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    "https://novacrm.com",
} as const;

export function absoluteUrl(path: string): string {
  return `${SITE.url}${path.startsWith("/") ? path : `/${path}`}`;
}
