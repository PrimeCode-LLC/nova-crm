"use client";

import * as React from "react";
import type { ActivityCounterRow } from "@/lib/types";
import {
  readLocalActivityRollups,
  removeLocalActivityRollupById,
  upsertLocalActivityRollup,
} from "@/lib/activity-local-rollups";

export function useLocalActivityRollups() {
  const [tick, setTick] = React.useState(0);
  const localRollups = React.useMemo(() => readLocalActivityRollups(), [tick]);
  const upsertLocalRollup = React.useCallback((row: ActivityCounterRow) => {
    upsertLocalActivityRollup(row);
    setTick((t) => t + 1);
  }, []);
  const removeLocalRollupById = React.useCallback((id: string) => {
    removeLocalActivityRollupById(id);
    setTick((t) => t + 1);
  }, []);
  return { localRollups, upsertLocalRollup, removeLocalRollupById };
}
