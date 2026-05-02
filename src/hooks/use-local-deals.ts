"use client";

import * as React from "react";
import type { Deal } from "@/lib/types";

const STORAGE_KEY = "crm_local_deals_v1";
const CHANGE_EVENT = "crm:local-deals-change";

const SERVER_EMPTY: Deal[] = [];

function readFromStorage(): Deal[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Deal[]) : [];
  } catch {
    return [];
  }
}

function writeToStorage(deals: Deal[]) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(deals));
}

let cachedSerialized = "";
let cachedDeals: Deal[] = SERVER_EMPTY;

function getSnapshot(): Deal[] {
  const next = readFromStorage();
  const serialized = JSON.stringify(next);
  if (serialized !== cachedSerialized) {
    cachedSerialized = serialized;
    cachedDeals = next;
  }
  return cachedDeals;
}

function getServerSnapshot(): Deal[] {
  return SERVER_EMPTY;
}

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

function notifyStoreChanged() {
  if (typeof window === "undefined") return;
  cachedSerialized = "";
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Session-scoped deals (e.g. created from the UI before a backend exists). */
export function useLocalDeals() {
  const localDeals = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const addLocalDeal = React.useCallback((deal: Deal) => {
    const next = [...readFromStorage(), deal];
    writeToStorage(next);
    notifyStoreChanged();
  }, []);

  return { localDeals, addLocalDeal };
}
