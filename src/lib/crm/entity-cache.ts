"use client";

import type { Account, Contact, Deal, Lead } from "@/lib/types";

type EntityMap = {
  leads: Lead;
  accounts: Account;
  contacts: Contact;
  deals: Deal;
};

const stores: { [K in keyof EntityMap]: Map<string, EntityMap[K]> } = {
  leads: new Map(),
  accounts: new Map(),
  contacts: new Map(),
  deals: new Map(),
};

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function rememberCrmEntities<K extends keyof EntityMap>(
  kind: K,
  rows: readonly EntityMap[K][],
): void {
  const store = stores[kind];
  let changed = false;
  for (const row of rows) {
    if (!row?.id) continue;
    if (store.get(row.id) !== row) {
      store.set(row.id, row);
      changed = true;
    }
  }
  if (changed) notify();
}

export function peekCrmEntity<K extends keyof EntityMap>(
  kind: K,
  id: string | undefined | null,
): EntityMap[K] | undefined {
  const key = id?.trim();
  if (!key) return undefined;
  return stores[kind].get(key);
}

export function subscribeCrmEntityCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
