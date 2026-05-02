"use client";

import * as React from "react";

type StoreWithPersist = {
  persist: {
    hasHydrated: () => boolean;
    onFinishHydration: (fn: () => void) => () => void;
  };
};

/** Avoid SSR/client mismatch for persisted zustand stores. */
export function useZustandPersistHydrated(store: StoreWithPersist): boolean {
  return React.useSyncExternalStore(
    (onStoreChange) => store.persist.onFinishHydration(onStoreChange),
    () => store.persist.hasHydrated(),
    () => false,
  );
}
