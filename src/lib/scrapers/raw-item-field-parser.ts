import type { ScraperRawItem } from "@/lib/types";

export function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

const PLATFORM_CREATOR_NAMES = new Set(
  ["linkedin", "twitter", "x", "facebook", "instagram", "reddit"].map((s) => s.toLowerCase()),
);

function isPlatformCreator(name: string): boolean {
  return PLATFORM_CREATOR_NAMES.has(name.trim().toLowerCase());
}

/** Best-effort company name from common RSS/scraper title patterns. */
export function companyNameFromRaw(
  item: Pick<ScraperRawItem, "title" | "feedName">,
): string {
  const title = stripHtml(item.title).trim();
  if (!title) return item.feedName?.trim().slice(0, 120) || "Unknown company";

  // LinkedIn job posts: "Acme Corp hiring Software Engineer in Austin, TX"
  const linkedinHiring = title.match(/^(.+?)\s+hiring\s+/i);
  if (linkedinHiring?.[1]) {
    const name = linkedinHiring[1].trim();
    if (name.length >= 2) return name.slice(0, 120);
  }

  // X/Twitter: "@handle / Display Name: post…"
  const xWithColon = title.match(/^@[\w.]+\s*\/\s*([^:]+?)\s*:/);
  if (xWithColon?.[1]) {
    const name = xWithColon[1].trim();
    if (name.length >= 2) return name.slice(0, 120);
  }

  // "Company - Job title" or "Company | Job title"
  const beforeSep = title.split(/\s[-–|]\s/)[0]?.trim();
  if (beforeSep && beforeSep.length >= 2 && beforeSep.length <= 80 && !beforeSep.startsWith("@")) {
    return beforeSep.slice(0, 120);
  }

  return item.feedName?.trim().slice(0, 120) || title.slice(0, 120) || "Unknown company";
}

export function contactNameFromRaw(
  item: Pick<ScraperRawItem, "title" | "creator" | "dcCreator">,
  companyName: string,
): { firstName: string; lastName: string; fullName: string } {
  const creator = item.creator?.trim() || item.dcCreator?.trim() || "";
  let raw = creator && !isPlatformCreator(creator) ? creator : "";

  if (!raw) {
    const xDisplay = item.title.match(/^@[\w.]+\s*\/\s*([^:]+?)\s*:/);
    if (xDisplay?.[1]) {
      raw = xDisplay[1].trim();
    } else if (/hiring/i.test(item.title)) {
      raw = "Hiring contact";
    } else {
      raw = companyName !== "Unknown company" ? companyName : "Unknown contact";
    }
  }

  const cleaned = stripHtml(raw).slice(0, 120) || "Unknown contact";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? "Unknown";
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : firstName;
  const fullName = firstName === lastName ? firstName : `${firstName} ${lastName}`;
  return { firstName, lastName, fullName };
}
