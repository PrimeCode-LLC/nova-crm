/**
 * Per-platform publishing playbooks.
 *
 * These encode what each platform's 2026 ranking system actually rewards, so the
 * AI writer produces platform-native copy instead of one generic post reused
 * everywhere. Reviewed July 2026 against:
 * - LinkedIn: dwell-time / comment-depth ranking, external-link suppression,
 *   and the 2026 "keeping conversations real" AI-slop demotion.
 * - X: Phoenix (Grok) scorer weighting replies, bookmarks and dwell far above
 *   likes; long-form single posts now distribute better than split threads.
 * - Instagram: the December 2025 hard cap of 5 hashtags, with discovery moving
 *   to caption keywords, alt text and shares.
 * - Reddit: self-promotion norms, native markdown, and title-driven ranking.
 *
 * Only a few of these are platform-confirmed: Instagram's 5-hashtag cap, the
 * character ceilings, and LinkedIn's demotion of content with no real
 * perspective. Everything else (length ranges, link costs, publish hours) is a
 * deliberate target drawn from published post-sample studies, so treat it as a
 * good default to test against rather than a law. Two things frequently
 * repeated elsewhere are deliberately not encoded here because the evidence
 * does not support them: a fixed percentage for LinkedIn's link penalty, and
 * any numeric weight for an X ranking signal.
 */

import type { ContentFormat, ContentPlatform } from "@/lib/content-calendar/types";

export type ContentCharRange = { min: number; max: number };

/**
 * Whether a link costs reach, and whether moving it to the first comment wins
 * that reach back. These are two separate questions with different answers per
 * platform: on X the first-reply move still works, on LinkedIn 2026 data splits
 * on whether link-bearing comments are themselves suppressed.
 */
export type ContentLinkPolicy = {
  /** True when a URL in the body measurably suppresses distribution. */
  bodyCostsReach: boolean;
  /** How well the first comment recovers what an in-body link costs. */
  firstComment: "reliable" | "contested" | "not_applicable";
  /** What the writer should actually do about links here. */
  guidance: string;
};

export type ContentPlatformPlaybook = {
  platform: ContentPlatform;
  /** Sweet-spot body length. The writer aims inside this, not at the ceiling. */
  bodyChars: ContentCharRange;
  /** Absolute ceiling the platform (or good taste) allows. */
  bodyHardLimit: number;
  /** Characters visible before the platform truncates with a "more" link. */
  previewChars: number;
  /** Allowed hashtag count. max 0 means hashtags are wrong on this platform. */
  hashtags: ContentCharRange;
  hashtagStyle: string;
  /** True when the platform renders markdown natively (only Reddit does). */
  rendersMarkdown: boolean;
  linkPolicy: ContentLinkPolicy;
  /** Local hour to publish, used when building schedule slots. */
  publishHour: number;
  /** What the ranking system rewards. */
  ranksOn: string[];
  /** Structure and formatting rules for the body. */
  formatting: string[];
  /** Platform-specific things that get a post suppressed or ignored. */
  avoid: string[];
  /** Hook patterns that earn the expand/stop-scroll on this platform. */
  hookGuidance: string;
  /** How the CTA should read here. */
  ctaGuidance: string;
  /** Extra rules when the item has a specific format. */
  formatGuidance: Partial<Record<ContentFormat, string>>;
};

const LINKEDIN: ContentPlatformPlaybook = {
  platform: "linkedin",
  bodyChars: { min: 900, max: 1900 },
  bodyHardLimit: 3000,
  previewChars: 140,
  hashtags: { min: 0, max: 3 },
  hashtagStyle:
    "Optional, and posts with none slightly outperform posts with them. 0 to 3 specific topic tags on their own final line. Hashtags are not a reach lever here (LinkedIn removed hashtag following), so skip them rather than pad with generic tags like #business or #innovation.",
  rendersMarkdown: false,
  linkPolicy: {
    bodyCostsReach: true,
    // 2026 data splits: some datasets show link-bearing comments suppressed too,
    // so the first comment is a fallback rather than a fix.
    firstComment: "contested",
    guidance:
      "Keep the body link-free. LinkedIn suppresses posts carrying an external URL, and the old 'link in first comment' workaround is no longer dependable, so the reliable play is to make the post self-contained and let interested readers ask. Only return a firstComment link when the click genuinely matters more than reach.",
  },
  publishHour: 9,
  ranksOn: [
    "Dwell time is the dominant signal. A post read for 30 seconds beats a post with 50 quick likes.",
    "Comment depth. Substantive replies (roughly 12+ words) count far more than one-word praise, so the post must give people something specific to argue with or add to.",
    "Saves and reposts signal lasting value. Frameworks, numbers and checklists get saved.",
    "The first 60 to 90 minutes decide distribution. If the opening lines do not earn the 'see more' tap, the post stops spreading.",
  ],
  formatting: [
    "Plain text. LinkedIn does not render markdown, so never emit **bold**, headings, or [text](url).",
    "One idea per post, 1 to 2 sentences per paragraph, a blank line between paragraphs. Dense blocks kill dwell time.",
    "Write long but read fast. Target 900 to 1900 characters, which forces the 'see more' expand.",
    "Enumerate with a plain hyphen and a space, and only when listing 3 or more concrete items. Never build the whole post as a bullet list.",
    "At most 1 to 2 emoji in the whole post, and never in the hook. The measured lift is entirely in the first one; past two it is flat, and one per line reads as machine-generated.",
    "Close with one open question that a peer can answer from their own experience.",
  ],
  avoid: [
    "External URLs in the body. They measurably cut reach, and native formats (text, document carousel, video) do not.",
    "The 'It is not X, it is Y' construction and other formulaic AI shapes. Readers now pattern-match these instantly and stop reading, and LinkedIn's authenticity classifier demotes posts with no real perspective.",
    "One-line-per-paragraph 'broetry', fake vulnerability, and hustle-culture platitudes.",
    "Engagement bait such as 'Agree?', 'Thoughts?', 'Comment YES below', or 'Repost if you agree'.",
    "Opening with 'I am excited to announce', 'In today's fast-paced world', or 'Let that sink in'.",
  ],
  hookGuidance:
    "Only about 140 characters show on mobile before 'see more', and truncation is line-based: roughly 3 rendered lines, where a blank line burns one. So the hook must be complete within 140 characters AND contain no line break. Open with a specific situation, a real number, a cost, or a claim a peer might push back on. Do not tease ('here is what I learned'), and never lead with an emoji.",
  ctaGuidance:
    "Soft and conversational. Invite a reply or a DM in plain language. Never a calendar link in the body, never 'Book a call now'.",
  formatGuidance: {
    carousel:
      "6 to 10 slides, since LinkedIn now weighs document completion rate. One idea per slide, a title slide that states the payoff, and a final slide with the soft CTA. Keep the post body to a 300 to 700 character setup that tells people why to swipe.",
    short_video:
      "Native vertical video, 30 to 90 seconds. Hook in the first 2 seconds. Body copy is a 300 to 700 character summary so the post still works with sound off.",
    text_post:
      "Pure text gets the cleanest organic distribution on LinkedIn. Use the full 900 to 1900 character range.",
    long_form:
      "Structure as an argument: situation, what most teams do, what actually worked, what it cost, what to copy. Still plain text.",
    graphic_post:
      "The image carries one number or one claim. The body copy must stand alone if the image never loads.",
    thread:
      "LinkedIn has no thread format. Write this as one text post instead.",
  },
};

const X: ContentPlatformPlaybook = {
  platform: "x",
  bodyChars: { min: 120, max: 260 },
  bodyHardLimit: 280,
  previewChars: 280,
  hashtags: { min: 0, max: 1 },
  hashtagStyle:
    "Usually zero. X classifies topics semantically now, and stacking hashtags reads as spam. One niche tag maximum, inline, only when it is a real community tag.",
  rendersMarkdown: false,
  linkPolicy: {
    bodyCostsReach: true,
    firstComment: "reliable",
    guidance:
      "No URL in the main post: X scores on-platform actions, so a post that exports the reader loses reach. Putting the link in your own first reply still works here, so return it in firstComment.",
  },
  publishHour: 10,
  ranksOn: [
    "Replies are the heaviest positive signal, and a reply the author answers back is worth more again.",
    "Bookmarks rank far above likes because they mark reference-grade content: frameworks, numbers, step-by-step breakdowns.",
    "Dwell and continuous dwell are scored separately, so a post worth stopping on beats a one-line quip.",
    "Likes are the weakest signal. Negative actions (mute, block, not-interested) actively push a post down.",
  ],
  formatting: [
    "Plain text, no markdown. No bullet characters in a short post.",
    "Front-load the claim in the first line. There is no expand, so the whole post must land in the feed.",
    "One idea, concrete nouns, real numbers. Cut every adverb and hedge.",
    "Avoid the awkward middle: either stay under 280 characters or commit to a genuinely long-form post. A 400-character post reads like a truncated thought.",
    "Lowercase-leaning, direct, peer-to-peer. No corporate voice.",
  ],
  avoid: [
    "External URLs in the body. Put the link in firstComment as a reply instead.",
    "Threads used to pad one thin idea. X now distributes a single strong post better than a split thread.",
    "Hashtag stacking, engagement bait ('RT if...'), and thread-bait openers like 'A thread 🧵' when there is no thread.",
    "Corporate announcement phrasing and emoji-bulleted lists.",
  ],
  hookGuidance:
    "Line one is the entire hook. Lead with the number, the contradiction, or the specific mistake. Assume the reader gives it a quarter of a second.",
  ctaGuidance:
    "Very light. A short question, an invitation to reply with their own case, or nothing at all. Bookmark-worthy content needs no CTA.",
  formatGuidance: {
    thread:
      "4 to 8 posts. Split by segments: each segment is one standalone post under 280 characters, each earns the next, and the first segment must work alone as a post. Put any link in the final segment. Only use a thread when the idea genuinely needs sequential steps.",
    long_form:
      "A single long-form post (Premium, up to 25000 characters) now distributes better than a thread. Target 1000 to 2500 characters, short paragraphs, one clear argument.",
    text_post: "Single post, 120 to 260 characters. Self-contained.",
    graphic_post:
      "The image should be readable at thumbnail size and carry the proof. Keep body copy under 200 characters.",
    carousel:
      "X has no carousel. Use a single image or split the idea into a short thread instead.",
    short_video:
      "Native video, under 60 seconds, captions burned in. Body copy under 200 characters.",
  },
};

const INSTAGRAM: ContentPlatformPlaybook = {
  platform: "instagram",
  bodyChars: { min: 300, max: 1200 },
  bodyHardLimit: 2200,
  previewChars: 125,
  hashtags: { min: 3, max: 5 },
  hashtagStyle:
    "Exactly 3 to 5 tags, and never more: Instagram hard-capped posts and Reels at 5 in December 2025 and silently ignores extras. The cap counts the caption and the first comment together, so there is no extra slot. Tags are classification, not reach, so pick narrow niche and community tags (#supplychainops, #warehouseautomation) over broad ones (#business, #tech). Put them on a final line.",
  rendersMarkdown: false,
  linkPolicy: {
    bodyCostsReach: false,
    firstComment: "not_applicable",
    guidance:
      "Instagram does not linkify caption URLs, so never write a bare URL. Point to the profile link and make the caption complete without the click.",
  },
  publishHour: 11,
  ranksOn: [
    "Sends per reach (DM shares) is the strongest distribution signal, especially for Reels. Write something a person would forward to a colleague.",
    "Saves matter most for carousels, which is why educational and framework content performs.",
    "Caption keywords, on-screen text and alt text now drive search and Explore discovery, since hashtag-following was removed.",
    "Watch time and completion rate for Reels.",
  ],
  formatting: [
    "Plain text, no markdown. Instagram renders none of it.",
    "The first 125 characters show before 'more', so the hook must be complete and specific before that cut.",
    "Short lines with blank lines between them. Captions are read on a phone in a crowded feed.",
    "Emoji are acceptable here in moderation, but never as bullet markers on every line.",
    "Weave the real search terms a buyer would type into the caption naturally: this is now the primary discovery path.",
    "Hashtags go on their own final line, separated from the caption by a blank line.",
  ],
  avoid: [
    "More than 5 hashtags. The extras are ignored and signal low-intent content.",
    "Generic tags (#business #success #motivation) that add no classification value.",
    "'Link in bio' as the entire CTA with no value in the caption itself.",
    "Dense B2B jargon. This is the most consumer-native surface, so the idea has to be legible to a non-expert in one read.",
  ],
  hookGuidance:
    "One concrete, human sentence inside the first 125 characters. A specific moment, cost, or result. On Instagram the visual and the first line do the work together, so the line should not repeat what the image already says.",
  ctaGuidance:
    "Conversational and low-friction: invite a save, a share to a colleague, or a DM. Saves and sends are the ranking signals worth asking for.",
  formatGuidance: {
    carousel:
      "The strongest B2B format on Instagram because carousels get saved. 6 to 10 slides via segments: slide 1 states the payoff, middle slides are one idea each, final slide is the CTA. Caption sets up the swipe in 300 to 800 characters.",
    short_video:
      "Reel, 15 to 45 seconds, hook in the first 1 to 2 seconds, captions burned in. Optimize for someone forwarding it in a DM.",
    graphic_post:
      "One number or one claim on the graphic. Caption carries the story.",
    text_post:
      "Instagram needs a visual. Treat this as a graphic post and write the caption to stand alone.",
    thread: "Instagram has no threads. Use a carousel instead.",
    long_form: "Cap the caption at 1200 characters and move the depth into carousel slides.",
  },
};

const REDDIT: ContentPlatformPlaybook = {
  platform: "reddit",
  bodyChars: { min: 800, max: 3500 },
  bodyHardLimit: 10_000,
  previewChars: 300,
  hashtags: { min: 0, max: 0 },
  hashtagStyle: "Never. Hashtags do nothing on Reddit and immediately mark a post as imported marketing.",
  rendersMarkdown: true,
  linkPolicy: {
    bodyCostsReach: false,
    firstComment: "not_applicable",
    guidance:
      "A link inside a substantial text post is fine. Never submit this as a link post: text posts draw far more comments and many subreddits' automod removes bare link submissions outright.",
  },
  publishHour: 14,
  ranksOn: [
    "Early upvote ratio inside the target subreddit. One wrong-community post dies regardless of quality.",
    "Comment discussion, especially the author answering follow-up questions in the thread.",
    "Reddit threads rank heavily in Google and are cited by AI answer engines, so a genuinely useful post keeps earning traffic for years.",
  ],
  formatting: [
    "Reddit renders markdown natively, so it is the one platform where headings, **bold**, and bullet lists are correct rather than noise.",
    "Lead with the concrete situation and the constraint. Reddit rewards specifics and punishes summary-speak.",
    "Write as a practitioner sharing what happened, including what did not work and what it cost. Admitting a tradeoff is what earns credibility here.",
    "Disclose the commercial relationship plainly if the story involves the brand's own work. Hiding it is what gets posts removed.",
    "The title carries most of the weight: make it a specific, non-clickbait statement or question a subreddit member would actually click.",
  ],
  avoid: [
    "Anything that reads like a case study or press release. Reddit removes and downvotes marketing copy on sight.",
    "Posting the same text to multiple subreddits, or posting without reading that subreddit's self-promotion rule first.",
    "Soft CTAs to book calls or demos. On Reddit the only acceptable ask is an offer to answer questions in the comments.",
    "Emoji, hashtags, and hype adjectives.",
  ],
  hookGuidance:
    "The title is the hook. State the specific problem and scale ('We cut driver status calls by 70% at a 40-truck 3PL, here is what actually moved the number'). No curiosity gaps, no 'Thread:' prefixes.",
  ctaGuidance:
    "Offer to answer questions in the comments. Nothing else. Any commercial ask must be a plain disclosure, not a pitch.",
  formatGuidance: {
    long_form:
      "The native Reddit format. 800 to 3500 characters with markdown headings and lists, written as a practitioner writeup.",
    text_post: "Same as long form. Reddit posts should be substantial or not posted at all.",
    graphic_post: "Image posts work in some subreddits, but the body text still has to carry the substance.",
    carousel: "Reddit has no carousel. Write it as a markdown post with numbered sections.",
    thread: "Reddit has no thread format. One post, then answer questions in the comments.",
    short_video: "Only in subreddits that allow video. Include a text writeup regardless.",
  },
};

export const CONTENT_PLATFORM_PLAYBOOKS: Record<ContentPlatform, ContentPlatformPlaybook> = {
  linkedin: LINKEDIN,
  x: X,
  instagram: INSTAGRAM,
  reddit: REDDIT,
};

export function getContentPlatformPlaybook(platform: ContentPlatform): ContentPlatformPlaybook {
  return CONTENT_PLATFORM_PLAYBOOKS[platform] ?? LINKEDIN;
}

/**
 * Target body length for a platform, narrowed when the format shifts the shape
 * (a carousel caption is a setup, not the whole argument).
 */
export function contentBodyCharTarget(
  platform: ContentPlatform,
  format?: ContentFormat,
): ContentCharRange {
  const book = getContentPlatformPlaybook(platform);
  if (!format) return book.bodyChars;

  // A Reel caption is functional text under a video, and long ones measurably
  // reach less. Keep it inside the 125-character visible window.
  if (format === "short_video" && platform === "instagram") return { min: 60, max: 125 };

  if (format === "carousel" || format === "short_video" || format === "graphic_post") {
    // Caption supports an asset rather than carrying the full argument.
    if (platform === "linkedin") return { min: 300, max: 900 };
    if (platform === "x") return { min: 80, max: 200 };
    // Skips the 51-125 band, which underperforms both shorter and longer captions.
    if (platform === "instagram") return { min: 300, max: 800 };
  }
  if (format === "thread" && platform === "x") {
    // Body holds the opening post; the rest lives in segments.
    return { min: 120, max: 260 };
  }
  if (format === "long_form" && platform === "x") {
    return { min: 1000, max: 2500 };
  }
  return book.bodyChars;
}

/** Formats that are written as an ordered list of standalone parts. */
export function formatUsesSegments(platform: ContentPlatform, format?: ContentFormat): boolean {
  if (format === "carousel") return platform === "instagram" || platform === "linkedin";
  if (format === "thread") return platform === "x";
  return false;
}

export function segmentCountTarget(
  platform: ContentPlatform,
  format?: ContentFormat,
): ContentCharRange | null {
  if (!formatUsesSegments(platform, format)) return null;
  if (format === "thread") return { min: 4, max: 8 };
  return { min: 6, max: 10 };
}

/** Per-platform publish hour so slots do not all land at 10:00. */
export function contentPublishHour(platform: ContentPlatform): number {
  return getContentPlatformPlaybook(platform).publishHour;
}

function bullets(lines: string[]): string {
  return lines.map((l) => `- ${l}`).join("\n");
}

/**
 * Render the playbook as a prompt block. This is the platform-specific
 * instruction set the writer must follow, injected per draft.
 */
export function formatPlatformPlaybookForPrompt(
  platform: ContentPlatform,
  format?: ContentFormat,
): string {
  const book = getContentPlatformPlaybook(platform);
  const target = contentBodyCharTarget(platform, format);
  const segments = segmentCountTarget(platform, format);
  const formatNote = format ? book.formatGuidance[format] : undefined;

  const sections: string[] = [
    `PLATFORM: ${platform}`,
    `Body length: aim for ${target.min} to ${target.max} characters. Hard ceiling ${book.bodyHardLimit}. Do not pad to reach the ceiling.`,
    `Visible before truncation: ~${book.previewChars} characters.`,
    book.hashtags.max === 0
      ? `Hashtags: none. ${book.hashtagStyle}`
      : `Hashtags: ${book.hashtags.min} to ${book.hashtags.max}. ${book.hashtagStyle}`,
    `Markdown: ${
      book.rendersMarkdown
        ? "supported and expected. Use headings, bold and lists where they help."
        : "NOT rendered. Emit plain text only."
    }`,
    `Links: ${book.linkPolicy.guidance}`,
    "",
    `What this platform's ranking rewards:\n${bullets(book.ranksOn)}`,
    "",
    `Formatting rules:\n${bullets(book.formatting)}`,
    "",
    `Never do this on ${platform}:\n${bullets(book.avoid)}`,
    "",
    `Hook: ${book.hookGuidance}`,
    `CTA: ${book.ctaGuidance}`,
  ];

  if (formatNote) {
    sections.push("", `Format (${format}): ${formatNote}`);
  }
  if (segments) {
    sections.push(
      `Segments: return ${segments.min} to ${segments.max} entries in segments, each one standalone and in order.`,
    );
  } else {
    sections.push("Segments: return an empty array. This format is a single body.");
  }

  return sections.join("\n");
}

/** Compact multi-platform summary used when planning topics across platforms. */
export function formatPlatformFitForPrompt(platforms: ContentPlatform[]): string {
  const rows = platforms.map((p) => {
    const book = getContentPlatformPlaybook(p);
    return [
      `${p}:`,
      `  audience mode: ${PLATFORM_AUDIENCE_MODE[p]}`,
      `  strong formats: ${PLATFORM_STRONG_FORMATS[p].join(", ")}`,
      `  weak formats: ${PLATFORM_WEAK_FORMATS[p].join(", ")}`,
      `  body length: ${book.bodyChars.min}-${book.bodyChars.max} chars`,
      `  hashtags: ${book.hashtags.max === 0 ? "none" : `${book.hashtags.min}-${book.hashtags.max}`}`,
    ].join("\n");
  });
  return rows.join("\n");
}

export const PLATFORM_AUDIENCE_MODE: Record<ContentPlatform, string> = {
  linkedin:
    "Buyers and peers reading during work. Rewards proof, specifics and a defensible opinion.",
  x: "Practitioners and founders skimming fast. Rewards sharp claims, real numbers and reference-grade breakdowns.",
  instagram:
    "Visual-first, half-attention scrolling. Rewards one legible idea a person forwards to a colleague.",
  reddit:
    "Skeptical practitioners inside a specific subreddit. Rewards candid detail and punishes anything that smells like marketing.",
};

export const PLATFORM_STRONG_FORMATS: Record<ContentPlatform, ContentFormat[]> = {
  linkedin: ["text_post", "carousel", "short_video"],
  x: ["text_post", "long_form", "thread"],
  instagram: ["carousel", "short_video", "graphic_post"],
  reddit: ["long_form", "text_post"],
};

export const PLATFORM_WEAK_FORMATS: Record<ContentPlatform, ContentFormat[]> = {
  linkedin: ["thread"],
  x: ["carousel"],
  instagram: ["text_post", "thread"],
  reddit: ["carousel", "thread", "short_video"],
};

/** Formats worth generating on a platform, used to keep planning realistic. */
export function isFormatViableOnPlatform(
  platform: ContentPlatform,
  format: ContentFormat,
): boolean {
  return !PLATFORM_WEAK_FORMATS[platform].includes(format);
}

/**
 * Coerce a planned format to something the platform actually supports, so a
 * plan never asks for an X carousel or a LinkedIn thread.
 */
export function coerceFormatForPlatform(
  platform: ContentPlatform,
  format: ContentFormat | undefined,
): ContentFormat {
  if (format && isFormatViableOnPlatform(platform, format)) return format;
  const fallback: Record<ContentPlatform, Record<string, ContentFormat>> = {
    linkedin: { thread: "text_post" },
    x: { carousel: "thread" },
    instagram: { text_post: "graphic_post", thread: "carousel" },
    reddit: { carousel: "long_form", thread: "long_form", short_video: "long_form" },
  };
  const mapped = format ? fallback[platform][format] : undefined;
  if (mapped) return mapped;
  return PLATFORM_STRONG_FORMATS[platform][0] ?? "text_post";
}
