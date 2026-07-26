import type { KnowledgeSection } from "@/lib/ai/fit-check-knowledge-types";
import type {
  ContentCaptureRequiredField,
  ContentCaptureType,
} from "@/lib/content-calendar/types";

export type { ContentCaptureType };

/** What kind of knowledge the capturer is feeding in (~60s field note). */
export const CONTENT_CAPTURE_TYPES: ContentCaptureType[] = [
  "win",
  "feature",
  "icp",
  "voice",
];

export const CONTENT_CAPTURE_TYPE_LABELS: Record<ContentCaptureType, string> = {
  win: "Win / lesson",
  feature: "Product / feature",
  icp: "ICP / positioning",
  voice: "Voice / take",
};

export const CONTENT_CAPTURE_TYPE_HINTS: Record<ContentCaptureType, string> = {
  win: "Client or delivery proof: problem → what you did → result",
  feature: "Product capability: name, what it does, who it helps",
  icp: "Who you sell to: buyer, pain, signals, objections",
  voice: "House style sample: topic, take, do/don’t say",
};

export type CaptureFieldKey = ContentCaptureRequiredField;

export type CaptureFieldDef = {
  key: CaptureFieldKey;
  label: string;
  placeholder: string;
  rows: number;
  /** When true, not required by default (brand policy can still require it). */
  optional?: boolean;
};

/** Storage still uses problem/solution/outcome/notes; labels adapt per type. */
export const CAPTURE_TYPE_FIELDS: Record<ContentCaptureType, CaptureFieldDef[]> = {
  win: [
    {
      key: "problem",
      label: "Problem",
      placeholder: "What went wrong or what the client needed…",
      rows: 3,
    },
    {
      key: "solution",
      label: "Solution",
      placeholder: "What you did…",
      rows: 3,
    },
    {
      key: "outcome",
      label: "Outcome",
      placeholder: "Result, metric, or lesson…",
      rows: 2,
      optional: true,
    },
    {
      key: "notes",
      label: "Extra notes",
      placeholder: "Anything else worth indexing…",
      rows: 2,
      optional: true,
    },
  ],
  feature: [
    {
      key: "problem",
      label: "Feature name",
      placeholder: "e.g. Automated email rerouting",
      rows: 2,
    },
    {
      key: "solution",
      label: "What it does",
      placeholder: "Concrete behavior — what the user can do…",
      rows: 3,
    },
    {
      key: "outcome",
      label: "Who it’s for / why it matters",
      placeholder: "Role, situation, and the job it finishes…",
      rows: 2,
      optional: true,
    },
    {
      key: "notes",
      label: "Extra notes",
      placeholder: "Limits, integrations, related features…",
      rows: 2,
      optional: true,
    },
  ],
  icp: [
    {
      key: "problem",
      label: "Who",
      placeholder: "Role, company type, or segment…",
      rows: 2,
    },
    {
      key: "solution",
      label: "Pain / need",
      placeholder: "The problem they feel in their words…",
      rows: 3,
    },
    {
      key: "outcome",
      label: "Ideal signal / objection",
      placeholder: "What makes them a fit — or what they push back on…",
      rows: 2,
      optional: true,
    },
    {
      key: "notes",
      label: "Extra notes",
      placeholder: "Trigger events, disqualifiers, language to use…",
      rows: 2,
      optional: true,
    },
  ],
  voice: [
    {
      key: "problem",
      label: "Topic",
      placeholder: "What this take is about…",
      rows: 2,
    },
    {
      key: "solution",
      label: "Your take",
      placeholder: "The claim or opinion in your voice…",
      rows: 3,
    },
    {
      key: "outcome",
      label: "Do say / don’t say",
      placeholder: "Phrases to prefer or avoid…",
      rows: 2,
      optional: true,
    },
    {
      key: "notes",
      label: "Extra notes",
      placeholder: "Tone cues, examples, related posts…",
      rows: 2,
      optional: true,
    },
  ],
};

const STRUCTURE_GUIDANCE: Record<ContentCaptureType, string> = {
  win: "Structure markdown with: Title, Context, Problem, Solution, Outcome, Lessons, Tags.",
  feature:
    "Structure markdown with: Title, Feature, Capability, Audience & value, Details, Limits (if any), Tags.",
  icp: "Structure markdown with: Title, Who, Pain, Ideal signals, Objections, Positioning notes, Tags.",
  voice:
    "Structure markdown with: Title, Topic, Take, Voice notes (do/don't), Sample phrasing, Tags.",
};

const MARKDOWN_KIND: Record<ContentCaptureType, string> = {
  win: "case study / lesson",
  feature: "product / feature knowledge note",
  icp: "ICP / positioning note",
  voice: "voice / brand tone sample",
};

export function normalizeCaptureType(raw: unknown): ContentCaptureType {
  if (typeof raw === "string" && CONTENT_CAPTURE_TYPES.includes(raw as ContentCaptureType)) {
    return raw as ContentCaptureType;
  }
  return "win";
}

/** RAG section for indexed docs. Internal captures always land in `other`. */
export function knowledgeSectionForCapture(
  captureType: ContentCaptureType,
  publicSafe: boolean,
): KnowledgeSection {
  if (!publicSafe) return "other";
  switch (captureType) {
    case "feature":
      return "services";
    case "icp":
      return "icp";
    case "voice":
      return "content_voice";
    case "win":
    default:
      return "case_studies";
  }
}

export function captureTypeStructureGuidance(captureType: ContentCaptureType): string {
  return STRUCTURE_GUIDANCE[captureType];
}

export function captureTypeMarkdownKind(captureType: ContentCaptureType): string {
  return MARKDOWN_KIND[captureType];
}

export function formatCaptureFieldsForPrompt(
  captureType: ContentCaptureType,
  fields: Partial<Record<CaptureFieldKey, string>>,
): string {
  return CAPTURE_TYPE_FIELDS[captureType]
    .map((def) => {
      const value = (fields[def.key] ?? "").trim() || "(empty)";
      return `${def.label}: ${value}`;
    })
    .join("\n");
}

export function captureDisplayTitle(input: {
  captureType?: ContentCaptureType | string;
  normalizedTitle?: string;
  problem?: string;
}): string {
  if (input.normalizedTitle?.trim()) return input.normalizedTitle.trim();
  const fallback = (input.problem ?? "").trim();
  return fallback ? fallback.slice(0, 80) : "Untitled capture";
}

export function captureFieldLabel(
  captureType: ContentCaptureType,
  key: CaptureFieldKey,
): string {
  return (
    CAPTURE_TYPE_FIELDS[captureType].find((f) => f.key === key)?.label ??
    key
  );
}
