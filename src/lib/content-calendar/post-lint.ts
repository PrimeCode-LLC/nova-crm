/**
 * Deterministic quality checks for a generated or hand-edited post.
 *
 * The model is told the platform rules, but it does not reliably follow them, so
 * these run afterwards and surface concrete problems to the writer. Findings are
 * advisory: nothing here blocks saving a draft.
 */

import {
  contentBodyCharTarget,
  getContentPlatformPlaybook,
  segmentCountTarget,
} from "@/lib/content-calendar/platform-playbooks";
import {
  contentVariantCharLimit,
  type ContentFormat,
  type ContentPlatform,
} from "@/lib/content-calendar/types";

export type ContentLintSeverity = "error" | "warn";

export type ContentLintFinding = {
  severity: ContentLintSeverity;
  /** Stable id so the UI can key findings and tests can assert on them. */
  code: string;
  message: string;
};

export type ContentLintResult = {
  findings: ContentLintFinding[];
  /** 0-100. Starts at 100 and loses points per finding. */
  score: number;
};

/**
 * Phrases that mark a post as machine-written. The first entry is the shape
 * LinkedIn publicly named when it announced AI-slop demotion in 2026.
 */
const AI_TELL_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bit'?s not (?:just )?[^.,;!?\n]{1,40}[,.]\s*it'?s\b/i, label: '"It is not X, it is Y"' },
  {
    pattern: /^\s*(?:the\s+)?(?:result|outcome|impact|catch|kicker|best part|problem|difference|takeaway|bottom line)\?/im,
    label: 'a one-word rhetorical question fragment ("The outcome?")',
  },
  { pattern: /\bin today'?s (?:fast[- ]paced|digital|competitive|ever[- ]changing)\b/i, label: '"in today\'s ... world"' },
  { pattern: /\bever[- ]evolving\b/i, label: '"ever-evolving"' },
  { pattern: /\blet that sink in\b/i, label: '"let that sink in"' },
  { pattern: /\bgame[- ]chang(?:er|ing)\b/i, label: '"game-changer"' },
  { pattern: /\brevolutioni[sz](?:e|ing|ed)\b|\brevolutionary\b/i, label: '"revolutionize"' },
  { pattern: /\bunlock(?:ing)? (?:the (?:power|potential)|your)\b/i, label: '"unlock the power"' },
  { pattern: /\bdelve into\b|\bdive deep(?:er)? into\b/i, label: '"delve into" / "dive deep into"' },
  { pattern: /\bhere'?s the (?:thing|kicker)\b/i, label: '"here\'s the thing"' },
  { pattern: /\b(?:excited|thrilled|humbled|honored) to (?:announce|share)\b/i, label: '"excited to announce"' },
  { pattern: /\bleverag(?:e|ing)\b/i, label: '"leverage" as a verb' },
  { pattern: /\bseamless(?:ly)?\b/i, label: '"seamless"' },
  { pattern: /\bsynergy\b|\bsynergies\b/i, label: '"synergy"' },
  { pattern: /\bcutting[- ]edge\b|\bstate[- ]of[- ]the[- ]art\b|\bworld[- ]class\b/i, label: '"cutting-edge" / "world-class"' },
  { pattern: /\bat the end of the day\b/i, label: '"at the end of the day"' },
  { pattern: /\ba (?:true )?testament to\b/i, label: '"a testament to"' },
  { pattern: /\bstaggering\b|\bremarkable\b|\bunparalleled\b/i, label: 'inflated adjectives ("staggering", "remarkable")' },
  { pattern: /\bsupercharge\b|\belevate your\b|\btransform your\b/i, label: '"supercharge" / "elevate your"' },
  { pattern: /\bnavigat(?:e|ing) the (?:complex|landscape)\b|\bbusiness landscape\b/i, label: '"navigating the landscape"' },
  { pattern: /\bready to (?:explore|transform|elevate|unlock|discover|take)\b/i, label: 'the "Ready to ...?" closing question' },
  { pattern: /\bdidn'?t stop there\b/i, label: '"didn\'t stop there"' },
  { pattern: /\bwhen it comes to\b/i, label: '"when it comes to"' },
];

/** Low-effort prompts that LinkedIn and X both treat as engagement bait. */
const ENGAGEMENT_BAIT = [
  /^\s*thoughts\?\s*$/im,
  /^\s*agree\?\s*$/im,
  /\bcomment (?:yes|below)\b/i,
  /\brepost if\b/i,
  /\bdouble tap if\b/i,
  /\btag someone who\b/i,
  /\bdrop a\b.{0,12}\bin the comments\b/i,
];

const URL_PATTERN = /https?:\/\/\S+|\bwww\.[a-z0-9-]+\.[a-z]{2,}/i;

const MARKDOWN_RESIDUE_PATTERN = /\*\*|^#{1,6}\s|\[[^\]]+\]\([^)]+\)|^```/m;

const EMOJI_PATTERN =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;

const SEVERITY_PENALTY: Record<ContentLintSeverity, number> = { error: 18, warn: 7 };

function countHashtags(body: string, hashtags: string[] | undefined): number {
  const inBody = body.match(/(?:^|\s)#[A-Za-z][\w]{1,}/g)?.length ?? 0;
  return inBody + (hashtags?.length ?? 0);
}

/** Lines that lead with an emoji, which is the classic AI listicle shape. */
function countEmojiLedLines(body: string): number {
  return body
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      return EMOJI_PATTERN.test(trimmed.slice(0, 3));
    }).length;
}

export function lintContentVariant(input: {
  platform: ContentPlatform;
  body: string;
  format?: ContentFormat;
  hashtags?: string[];
  segments?: string[];
  firstComment?: string;
  bannedPhrases?: string[];
}): ContentLintResult {
  const { platform, format } = input;
  const body = input.body ?? "";
  const findings: ContentLintFinding[] = [];

  const book = getContentPlatformPlaybook(platform);
  const target = contentBodyCharTarget(platform, format);
  const hardLimit = contentVariantCharLimit(platform, format);

  const push = (severity: ContentLintSeverity, code: string, message: string) => {
    findings.push({ severity, code, message });
  };

  if (!body.trim()) {
    return { findings: [{ severity: "error", code: "empty", message: "Body is empty." }], score: 0 };
  }

  // Length.
  if (body.length > hardLimit) {
    push(
      "error",
      "over_hard_limit",
      `${body.length} characters exceeds the ${platform} limit of ${hardLimit}.`,
    );
  } else if (body.length > target.max) {
    push(
      "warn",
      "over_target",
      `${body.length} characters is longer than the ${target.min}-${target.max} sweet spot for ${platform}. Cut the weakest paragraph.`,
    );
  } else if (body.length < target.min) {
    push(
      "warn",
      "under_target",
      `${body.length} characters is thinner than the ${target.min}-${target.max} range that earns dwell time on ${platform}.`,
    );
  }

  // Hook: the visible slice before the platform truncates.
  const firstLine = body.split("\n")[0]?.trim() ?? "";
  if (firstLine.length > book.previewChars) {
    push(
      "warn",
      "hook_truncated",
      `The first line runs ${firstLine.length} characters but only ~${book.previewChars} show before ${platform} truncates. Land the point earlier.`,
    );
  }

  // Hashtags.
  const hashtagCount = countHashtags(body, input.hashtags);
  if (book.hashtags.max === 0 && hashtagCount > 0) {
    push("error", "hashtags_not_allowed", `Hashtags do not belong on ${platform}. Remove all ${hashtagCount}.`);
  } else if (hashtagCount > book.hashtags.max) {
    push(
      "error",
      "too_many_hashtags",
      platform === "instagram"
        ? `${hashtagCount} hashtags exceeds Instagram's hard cap of 5. Extras are ignored and signal low-intent content.`
        : `${hashtagCount} hashtags is more than the ${book.hashtags.max} that work on ${platform}.`,
    );
  } else if (book.hashtags.min > 0 && hashtagCount < book.hashtags.min) {
    push(
      "warn",
      "too_few_hashtags",
      `${platform} expects ${book.hashtags.min} to ${book.hashtags.max} niche tags for classification. Found ${hashtagCount}.`,
    );
  }

  // Links.
  if (book.linkPolicy.bodyCostsReach && URL_PATTERN.test(body)) {
    push(
      "error",
      "link_in_body",
      book.linkPolicy.firstComment === "reliable"
        ? `A URL in the body suppresses reach on ${platform}. Move it to the first comment.`
        : `A URL in the body suppresses reach on ${platform}, and moving it to the first comment no longer reliably recovers it. Drop the link and let the post stand alone.`,
    );
  }

  // Markdown that the platform will render as literal noise.
  if (!book.rendersMarkdown && MARKDOWN_RESIDUE_PATTERN.test(body)) {
    push(
      "error",
      "markdown_residue",
      `${platform} does not render markdown, so asterisks, headings and link syntax show up literally.`,
    );
  }

  // AI-tell language.
  for (const { pattern, label } of AI_TELL_PATTERNS) {
    if (pattern.test(body)) {
      push("warn", "ai_tell", `Reads as AI-written: ${label}. Rewrite in the brand's own words.`);
    }
  }

  if (ENGAGEMENT_BAIT.some((p) => p.test(body))) {
    push("warn", "engagement_bait", "Engagement bait is demoted. Ask a specific question instead.");
  }

  const emojiLines = countEmojiLedLines(body);
  if (emojiLines >= 3) {
    push(
      "warn",
      "emoji_listicle",
      `${emojiLines} lines start with an emoji. That listicle shape is a strong AI tell.`,
    );
  }

  // Segments for formats that are written as ordered parts.
  const segmentTarget = segmentCountTarget(platform, format);
  const segmentCount = input.segments?.filter((s) => s.trim()).length ?? 0;
  if (segmentTarget) {
    if (segmentCount === 0) {
      push(
        "error",
        "segments_missing",
        `A ${format} on ${platform} needs ${segmentTarget.min} to ${segmentTarget.max} parts. None were generated.`,
      );
    } else if (segmentCount < segmentTarget.min || segmentCount > segmentTarget.max) {
      push(
        "warn",
        "segment_count",
        `${segmentCount} parts is outside the ${segmentTarget.min} to ${segmentTarget.max} range that performs for a ${format}.`,
      );
    }
    if (platform === "x" && format === "thread") {
      const overLong = input.segments?.filter((s) => s.trim().length > 280).length ?? 0;
      if (overLong > 0) {
        push("error", "segment_too_long", `${overLong} thread post(s) exceed 280 characters.`);
      }
    }
  } else if (segmentCount > 0) {
    push("warn", "segments_unused", `Segments were generated but a ${format} on ${platform} is a single post.`);
  }

  // Brand-level bans.
  for (const phrase of input.bannedPhrases ?? []) {
    const needle = phrase.trim();
    if (needle && body.toLowerCase().includes(needle.toLowerCase())) {
      push("error", "banned_phrase", `Contains a banned brand phrase: "${needle}".`);
    }
  }

  const penalty = findings.reduce((sum, f) => sum + SEVERITY_PENALTY[f.severity], 0);
  return { findings, score: Math.max(0, 100 - penalty) };
}

export function contentLintSummary(result: ContentLintResult): string {
  const errors = result.findings.filter((f) => f.severity === "error").length;
  const warns = result.findings.length - errors;
  if (errors === 0 && warns === 0) return "Passes platform checks";
  const parts: string[] = [];
  if (errors) parts.push(`${errors} to fix`);
  if (warns) parts.push(`${warns} to review`);
  return parts.join(", ");
}
