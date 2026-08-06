/**
 * Marketing-site config. Read once, used by metadata, sitemap, and robots.
 * Override the URL with NEXT_PUBLIC_SITE_URL in production.
 */
export const SITE = {
  name: "Nova",
  /** Short product identity for wordmarks */
  productName: "Nova",
  tagline: "Nova books the meetings. You stop hiring another SDR.",
  description:
    "Nova is for B2B service and SaaS owners running outbound with more pipeline than headcount. It personalizes outreach, runs follow-ups, reads every reply, and advances the deal — grounded in how you actually sell.",
  oneLiner:
    "Nova books meetings without another SDR hire — personalized outbound, grounded in your business, under your approval.",
  salesEmail: "sales@stellixsoft.com",
  url:
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    "https://novacrm.com",
} as const;

export function absoluteUrl(path: string): string {
  return `${SITE.url}${path.startsWith("/") ? path : `/${path}`}`;
}
