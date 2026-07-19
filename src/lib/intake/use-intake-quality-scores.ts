"use client";

import * as React from "react";
import { scoreIntakeItem } from "@/lib/intent/score-intake-item";
import type { IntentPlaybook, QualityScoreResult } from "@/lib/intent/types";
import type { ScraperRawItem } from "@/lib/types";

const CHUNK = 25;

/**
 * Score intake rows in animation-frame chunks so a 200-item pool doesn't block
 * first paint. Returns a growing map; filters/sorts become more accurate as it fills.
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
  const playbookRef = React.useRef(playbook);
  playbookRef.current = playbook;

  React.useEffect(() => {
    if (items.length === 0) {
      setQualityById(new Map());
      setScoring(false);
      return;
    }

    let cancelled = false;
    let index = 0;
    const map = new Map<string, QualityScoreResult>();
    setScoring(true);

    const tick = () => {
      if (cancelled) return;
      const pb = playbookRef.current;
      const end = Math.min(index + CHUNK, items.length);
      for (; index < end; index += 1) {
        const item = items[index]!;
        map.set(item.id, scoreIntakeItem(item, pb));
      }
      setQualityById(new Map(map));
      if (index < items.length) {
        requestAnimationFrame(tick);
      } else {
        setScoring(false);
      }
    };

    const raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // Re-score when the item set or playbook definition changes — not on every context render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- playbookKey tracks meaningful playbook edits
  }, [items, playbook.templateId, playbook.updatedAt, playbook.signals.length]);

  return { qualityById, scoring };
}
