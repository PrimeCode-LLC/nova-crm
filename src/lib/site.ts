/**
 * Marketing-site config. Read once, used by metadata, sitemap, and robots.
 * Override the URL with NEXT_PUBLIC_SITE_URL in production.
 */
export const SITE = {
  name: "Nova CRM",
  tagline: "Multi-channel sales ops, finally sane.",
  url:
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    "https://novacrm.com",
} as const;

export function absoluteUrl(path: string): string {
  return `${SITE.url}${path.startsWith("/") ? path : `/${path}`}`;
}
