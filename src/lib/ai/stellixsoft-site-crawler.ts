/**
 * Crawls stellixsoft.com marketing pages for Fit Check RAG seeding.
 * Public content only - same paths a visitor can browse.
 */

export const STELLIXSOFT_SITE_ORIGIN = "https://stellixsoft.com";

const MAX_PAGES = 48;
const FETCH_TIMEOUT_MS = 12_000;
const FETCH_CONCURRENCY = 6;
const MAX_CONTENT_CHARS = 42_000;

/** Marketing paths discovered from stellixsoft.com (used for fast, complete seeds). */
export const STELLIXSOFT_KNOWN_PATHS = [
  "/",
  "/about",
  "/contact",
  "/pricing",
  "/faqs",
  "/blog",
  "/services",
  "/services/enterprise-development",
  "/services/legacy-modernization",
  "/services/iot-software",
  "/services/dedicated-development-teams",
  "/services/devops-and-cloud-services",
  "/services/enterprise-mobile-app-development",
  "/services/automation-and-custom-apps",
  "/services/e-commerce-development",
  "/services/maintenance-support",
  "/services/salesforce-development",
  "/services/blockchain-and-cryptography",
  "/services/practical-for-ai",
  "/industries",
  "/industries/iot-and-hardware",
  "/industries/healthcare-and-medtech",
  "/industries/logistics-and-supply-chain",
  "/industries/enterprise-software-development",
  "/case-studies",
  "/case-studies/enterprise-portal-modernization",
  "/case-studies/logistics-management-platform",
  "/case-studies/compliance-and-audit-management-system",
  "/case-studies/multi-location-service-business-platform",
  "/case-studies/stock-options-and-equity-management-platform",
] as const;

export type CrawledSitePage = {
  url: string;
  title: string;
  content: string;
};

/** Paths included in the fit-check knowledge crawl. */
export function isFitCheckCrawlUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host !== "stellixsoft.com") return false;
    const p = u.pathname.replace(/\/$/, "") || "/";
    if (p.startsWith("/_next") || /\.(css|js|woff2?|png|jpe?g|webp|svg|ico)$/i.test(p)) {
      return false;
    }
    if (p === "/privacy-policy" || p === "/terms-of-service") return false;
    if (p.startsWith("/blog/") && p !== "/blog") return false;

    return (
      p === "/" ||
      p === "/about" ||
      p === "/contact" ||
      p === "/pricing" ||
      p === "/faqs" ||
      p === "/blog" ||
      p.startsWith("/services") ||
      p.startsWith("/industries") ||
      p.startsWith("/case-studies")
    );
  } catch {
    return false;
  }
}

function normalizeUrl(url: string): string {
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  let path = u.pathname.replace(/\/$/, "") || "/";
  return `${u.origin}${path}`;
}

function extractLinks(html: string, origin: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    let href = m[1]!.trim();
    if (href.startsWith("/")) href = `${origin}${href}`;
    if (!href.startsWith("http")) continue;
    try {
      const norm = normalizeUrl(href);
      if (isFitCheckCrawlUrl(norm)) out.add(norm);
    } catch {
      /* skip */
    }
  }
  return [...out];
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Isolates the substantive page region before text extraction: prefers the
 * <main> element and strips repeated site chrome (header/nav/footer/aside) that
 * otherwise pollutes every crawled document with the same menu and legal text.
 */
export function isolateMainContentHtml(html: string): string {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const region = main?.[1] ?? html;
  return region
    .replace(/<header\b[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, " ");
}

/** Common marketing/nav/legal boilerplate that survives tag stripping. */
const BOILERPLATE_PATTERNS: RegExp[] = [
  /skip to main content/gi,
  /\bloading\.{0,3}/gi,
  /schedule a (free )?(discovery )?call/gi,
  /reviews?\s*(&|and)\s*listings[\s\S]{0,80}?(clutch|goodfirms|trustpilot)[\s\S]{0,40}/gi,
  /©\s*\d{4}[\s\S]{0,120}?all rights reserved\.?/gi,
  /privacy policy/gi,
  /terms of service/gi,
];

export function stripBoilerplate(text: string): string {
  let out = text;
  for (const pattern of BOILERPLATE_PATTERNS) out = out.replace(pattern, " ");
  return out.replace(/\s+/g, " ").trim();
}

export function htmlToPlainText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function pageTitleFromHtml(html: string, url: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og?.[1]) return decodeHtmlEntities(og[1].trim());
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (t?.[1]) {
    return decodeHtmlEntities(t[1].split("|")[0]!.trim());
  }
  try {
    const path = new URL(url).pathname;
    if (path === "/" || path === "") return "Home";
    return path.split("/").filter(Boolean).pop()?.replace(/-/g, " ") ?? url;
  } catch {
    return url;
  }
}

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "StellixSoft-CRM-FitCheck/1.0 (+https://stellixsoft.com)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

export function pageToKnowledgeDocument(page: CrawledSitePage): { title: string; content: string } {
  const body = page.content.slice(0, MAX_CONTENT_CHARS);
  return {
    title: page.title.slice(0, 200),
    content: [
      `# ${page.title}`,
      "",
      `Source URL: ${page.url}`,
      "",
      "## Extracted page content",
      "",
      body,
    ].join("\n"),
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const idx = next++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

async function fetchPage(url: string): Promise<CrawledSitePage | null> {
  const html = await fetchHtml(url);
  if (!html) return null;
  const cleaned = stripBoilerplate(htmlToPlainText(isolateMainContentHtml(html)));
  // Fall back to the full page text if chrome-stripping removed too much.
  const plain = cleaned.length >= 120 ? cleaned : htmlToPlainText(html);
  if (plain.length < 120) return null;
  return {
    url,
    title: pageTitleFromHtml(html, url),
    content: plain,
  };
}

/** Fetch all known stellixsoft.com marketing URLs in parallel. */
export async function crawlStellixSoftSite(
  origin = STELLIXSOFT_SITE_ORIGIN,
): Promise<CrawledSitePage[]> {
  const base = origin.replace(/\/$/, "");
  const knownUrls = STELLIXSOFT_KNOWN_PATHS.map((p) =>
    normalizeUrl(p === "/" ? base : `${base}${p}`),
  )
    .filter(isFitCheckCrawlUrl)
    .slice(0, MAX_PAGES);

  const fetched = await mapPool(knownUrls, FETCH_CONCURRENCY, fetchPage);
  return fetched.filter((p): p is CrawledSitePage => p != null).sort((a, b) => a.url.localeCompare(b.url));
}

/** Curated ICP summary prepended to the library (always included). */
export function stellixSoftFitCheckProfileDoc(): { title: string; content: string } {
  return {
    title: "StellixSoft, Company fit profile (curated)",
    content: `# StellixSoft, Company fit profile

Use this document as the primary ICP and positioning reference for opportunity fit checks.

## Who we are
StellixSoft is a custom software development company building IoT platforms, legacy modernization, real-time systems, and enterprise applications for hardware companies and mission-critical operations.

## Ideal customer profile (ICP)
- Enterprise or mid-market B2B with complex operations (logistics, supply chain, hardware/IoT, healthcare/MedTech).
- Needs multi-tenant platforms, device management, dispatch/tracking, client portals, or legacy .NET/VB modernization.
- Values long-term partnership (typical 3+ year relationships), US timezone alignment, direct developer access.
- Budget-conscious vs US in-house hiring but needs enterprise quality (often compared to agencies and internal teams).

## Core services
- Enterprise development (mission-critical, multi-tenant).
- Legacy modernization (VB.NET / .NET Framework → .NET Core, React/TypeScript frontends).
- IoT software (device management, customer portals, integrations).
- Dedicated development teams, DevOps/cloud (AWS/Azure/GCP), mobile (Flutter/React Native), automation, e-commerce, Salesforce, maintenance.

## Industries
- IoT & hardware manufacturers
- Healthcare & MedTech (HIPAA-aware)
- Logistics & supply chain
- Enterprise software

## Technology strengths
- Backend: .NET Core 6/7/8, Node.js, SignalR (real-time), multi-tenant architecture
- Frontend: React, Next.js, TypeScript
- Mobile: Flutter, React Native
- Data/cloud: AWS/Azure/GCP, SQL Server, PostgreSQL, MongoDB, Redis, Docker/Kubernetes
- Quality: 70%+ test coverage, CI/CD, code reviews, GDPR/HIPAA/ISO available

## Commercial model
- Hourly: approximately $25–40/hr (positioned below typical US agency $50–100/hr and in-house $80–150/hr).
- Time to start: ~2 weeks vs months for hiring.
- Full IP ownership from day one.
- 14-day satisfaction check-in on new engagements.
- Pilot / discovery projects available before full engagement.

## Proof points
- Fortune 500 supply chain / device management (10,000+ devices, multi-year engagement, zero-downtime legacy migration).
- Case studies: enterprise portal modernization, logistics platforms, compliance/audit systems, multi-location service businesses, equity management platforms.

## Strong fit signals for opportunities
- .NET / React / Node / AWS stack matches
- Legacy migration or greenfield enterprise portal
- IoT + web/mobile companion software
- Real-time tracking, dispatch, multi-tenant SaaS
- HIPAA or regulated industry with need for compliant architecture

## Poor fit / hard nos (default Pass unless exceptional)
- Pure marketing websites or brochureware-only with no engineering depth
- Race-to-bottom commodity WordPress-only builds with tiny budget
- Stacks we do not support as primary delivery (e.g. solo PHP maintenance with no enterprise scope) unless upsell to modernization
- Requests that conflict with full IP ownership or require unethical work
- Unclear buyer with no budget and no timeline when pipeline is full (use Maybe, not Pursue)

## Contact
- Website: https://stellixsoft.com
- Email: info@stellixsoft.com
`,
  };
}
