import type { ScriptLibraryItem } from "./types";
import { mockScriptLibrary } from "./mock-data";

const STORAGE_KEY = "nova-crm-demo-scripts-session-v1";

export type DemoScriptsSession = {
  added: ScriptLibraryItem[];
  removedIds: string[];
  updates: Record<
    string,
    Partial<Pick<ScriptLibraryItem, "title" | "category" | "primaryText" | "secondaryText" | "content" | "tags">>
  >;
};

export function emptyDemoScriptsSession(): DemoScriptsSession {
  return { added: [], removedIds: [], updates: {} };
}

export function readDemoScriptsSession(): DemoScriptsSession {
  if (typeof window === "undefined") return emptyDemoScriptsSession();
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDemoScriptsSession();
    const p = JSON.parse(raw) as Partial<DemoScriptsSession>;
    return {
      added: Array.isArray(p.added) ? p.added : [],
      removedIds: Array.isArray(p.removedIds) ? p.removedIds : [],
      updates: p.updates && typeof p.updates === "object" ? p.updates : {},
    };
  } catch {
    return emptyDemoScriptsSession();
  }
}

export function writeDemoScriptsSession(session: DemoScriptsSession): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* quota */
  }
}

export function mergeDemoScriptsSession(
  base: ScriptLibraryItem[],
  session: DemoScriptsSession,
): ScriptLibraryItem[] {
  const removed = new Set(session.removedIds);
  const merged = base
    .filter((x) => !removed.has(x.id))
    .map((x) => {
      const u = session.updates[x.id];
      if (!u) return x;
      const next: ScriptLibraryItem = { ...x, ...u };
      if (u.primaryText != null || u.secondaryText != null) {
        const pt = u.primaryText ?? x.primaryText;
        const st = u.secondaryText ?? x.secondaryText ?? "";
        next.content = [pt, st].filter(Boolean).join("\n\n");
      }
      return next;
    });
  const baseIds = new Set(merged.map((m) => m.id));
  const extras = session.added.filter((a) => !baseIds.has(a.id));
  return [...extras, ...merged].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function demoSessionAfterCreate(
  session: DemoScriptsSession,
  item: ScriptLibraryItem,
): DemoScriptsSession {
  return { ...session, added: [item, ...session.added] };
}

export function demoSessionAfterUpdate(
  session: DemoScriptsSession,
  id: string,
  patch: DemoScriptsSession["updates"][string],
): DemoScriptsSession {
  const inAdded = session.added.findIndex((x) => x.id === id);
  if (inAdded >= 0) {
    const next = [...session.added];
    const cur = next[inAdded]!;
    const mergedPatch = { ...patch };
    const primaryText = mergedPatch.primaryText ?? cur.primaryText;
    const secondaryText = mergedPatch.secondaryText ?? cur.secondaryText ?? "";
    next[inAdded] = {
      ...cur,
      ...mergedPatch,
      content: [primaryText, secondaryText].filter(Boolean).join("\n\n"),
      updatedAt: new Date().toISOString(),
    };
    return { ...session, added: next };
  }
  if (mockScriptLibrary.some((x) => x.id === id)) {
    return {
      ...session,
      updates: { ...session.updates, [id]: { ...session.updates[id], ...patch } },
    };
  }
  return session;
}

export function demoSessionAfterDelete(session: DemoScriptsSession, id: string): DemoScriptsSession {
  if (session.added.some((x) => x.id === id)) {
    return { ...session, added: session.added.filter((x) => x.id !== id) };
  }
  if (mockScriptLibrary.some((x) => x.id === id)) {
    if (session.removedIds.includes(id)) return session;
    return { ...session, removedIds: [...session.removedIds, id] };
  }
  return session;
}
