"use client";

import * as React from "react";
import { scoreIntakeItem } from "@/lib/intent/score-intake-item";
import type { IntentPlaybook, QualityScoreResult } from "@/lib/intent/types";
import type { ScraperRawItem } from "@/lib/types";

const CHUNK = 25;
const EMPTY_QUALITY_SCORES = new Map<string, QualityScoreResult>();

/**
 * Score intake rows in animation-frame chunks so a 200-item pool doesn't block
 * first paint. Publishes the completed map once to avoid re-filtering and strategy
 * matching the whole pool after every chunk.
 */
export function useIntakeQualityScores(
  items: readonly ScraperRawItem[],
  playbook: IntentPlaybook,
): {
  qualityById: Map<string, QualityScoreResult>;
  scoring: boolean;
} {
  const [qualityById, setQualityById] = React.useState(
    () => new Map<string, QualityScoreResult>(),
  );
  const [scoring, setScoring] = React.useState(false);

  React.useEffect(() => {
    if (items.length === 0) return;

    let cancelled = false;
    let index = 0;
    const map = new Map<string, QualityScoreResult>();

    const tick = () => {
      if (cancelled) return;
      const end = Math.min(index + CHUNK, items.length);
      for (; index < end; index += 1) {
        const item = items[index]!;
        map.set(item.id, scoreIntakeItem(item, playbook));
      }
      if (index < items.length) {
        requestAnimationFrame(tick);
      } else {
        setQualityById(new Map(map));
        setScoring(false);
      }
    };

    const raf = requestAnimationFrame(() => {
      setScoring(true);
      tick();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [items, playbook]);

  return {
    qualityById: items.length === 0 ? EMPTY_QUALITY_SCORES : qualityById,
    scoring: items.length > 0 && scoring,
  };
}
