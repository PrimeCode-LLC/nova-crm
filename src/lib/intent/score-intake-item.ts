import type { Lead, ScraperRawItem } from "@/lib/types";
import type { IntentPlaybook, QualityScoreResult } from "@/lib/intent/types";
import {
  computeQualityScore,
  type QualityScoreLeadInput,
} from "@/lib/intent/compute-quality-score";

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Plain-text body used for scoring and promote seeding. */
export function intakeItemPlainText(item: Pick<ScraperRawItem, "title" | "content" | "contentSnippet">): {
  title: string;
  body: string;
} {
  const title = item.title.trim();
  const body =
    item.contentSnippet?.trim() ||
    stripHtml(item.content).slice(0, 4000);
  return { title, body };
}

/**
 * Map an intake pool post onto the Quality Score lead input shape so the same
 * Intent Playbook engine can score RSS/social posts before promote.
 */
export function intakeItemToQualityInput(
  item: Pick<ScraperRawItem, "title" | "content" | "contentSnippet" | "category" | "feedName">,
): QualityScoreLeadInput {
  const { title, body } = intakeItemPlainText(item);
  const corpus = [title, body].filter(Boolean).join("\n");
  const category = String(item.category ?? "").toLowerCase();

  return {
    triggerEvent: title || undefined,
    notes: `Intake · ${item.feedName}\n${corpus}`,
    hiringSignals: category === "hiring" ? corpus : undefined,
    painPoints: category === "problem" ? corpus : undefined,
    touches: 0,
  };
}

/** Score an intake item with the org Intent Playbook (pure, free, client-safe). */
export function scoreIntakeItem(
  item: Pick<ScraperRawItem, "title" | "content" | "contentSnippet" | "category" | "feedName">,
  playbook: IntentPlaybook,
): QualityScoreResult {
  return computeQualityScore(intakeItemToQualityInput(item), playbook);
}

/**
 * Research fields to seed on a new prospect when promoting from intake.
 * Keeps a source note block and routes body text into hiring/pain when the feed category fits.
 */
export function researchFieldsFromIntakeItem(item: ScraperRawItem): Pick<
  Lead,
  "notes" | "triggerEvent" | "hiringSignals" | "painPoints" | "businessFocus"
> {
  const { title, body } = intakeItemPlainText(item);
  const category = String(item.category ?? "").toLowerCase();
  const snippet = body.slice(0, 800);
  const notes = [
    `Source: ${item.feedName} (${item.platform} · ${item.category})`,
    `Link: ${item.link}`,
    snippet ? `\n${snippet}` : "",
  ]
    .join("\n")
    .trim();

  const out: Pick<
    Lead,
    "notes" | "triggerEvent" | "hiringSignals" | "painPoints" | "businessFocus"
  > = {
    notes,
    triggerEvent: title || undefined,
  };

  if (category === "hiring" && body) {
    out.hiringSignals = body.slice(0, 1500);
  } else if (category === "problem" && body) {
    out.painPoints = body.slice(0, 1500);
  } else if (body) {
    out.businessFocus = body.slice(0, 1500);
  }

  return out;
}
