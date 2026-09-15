/**
 * Segment helpers for scorecard rollups.
 */

export function seniorityBracketFromTitle(title: string | undefined | null): string {
  const t = (title ?? "").toLowerCase();
  if (!t) return "unknown";
  if (/\b(ceo|cto|cfo|coo|chief|founder|co-founder|owner|president)\b/.test(t)) {
    return "c_level";
  }
  if (/\b(vp|vice president|svp|evp)\b/.test(t)) return "vp";
  if (/\b(director|head of)\b/.test(t)) return "director";
  if (/\b(manager|lead)\b/.test(t)) return "manager";
  if (/\b(senior|sr\.|staff|principal)\b/.test(t)) return "senior_ic";
  return "ic";
}

export type SegmentBucket = {
  sent: number;
  delivered: number;
  positiveReplies: number;
  engagedReplies: number;
};

export function emptySegmentBucket(): SegmentBucket {
  return { sent: 0, delivered: 0, positiveReplies: 0, engagedReplies: 0 };
}

export function bumpSegment(
  map: Map<string, SegmentBucket>,
  key: string,
  patch: Partial<SegmentBucket>,
): void {
  const cur = map.get(key) ?? emptySegmentBucket();
  map.set(key, {
    sent: cur.sent + (patch.sent ?? 0),
    delivered: cur.delivered + (patch.delivered ?? 0),
    positiveReplies: cur.positiveReplies + (patch.positiveReplies ?? 0),
    engagedReplies: cur.engagedReplies + (patch.engagedReplies ?? 0),
  });
}

export function segmentsToJson(input: {
  bySeniority: Map<string, SegmentBucket>;
  byIndustry: Map<string, SegmentBucket>;
}): Record<string, unknown> {
  const serialize = (m: Map<string, SegmentBucket>) => {
    const out: Record<string, SegmentBucket & { positiveReplyRate: number }> = {};
    for (const [k, v] of m) {
      out[k] = {
        ...v,
        positiveReplyRate: v.delivered > 0 ? v.positiveReplies / v.delivered : 0,
      };
    }
    return out;
  };
  return {
    bySeniority: serialize(input.bySeniority),
    byIndustry: serialize(input.byIndustry),
  };
}
