import { createHash } from "node:crypto";

export type OutreachZone = "lab" | "canary" | "default";

export type OutreachConfigStatus =
  | "draft"
  | "lab_passed"
  | "canary"
  | "active"
  | "archived"
  | "rejected";

export type ClassifiedBy = "ai" | "heuristic" | "fallback";

/** Simple Levenshtein distance for edit-distance on sent vs generated copy. */
export function levenshteinDistance(a: string, b: string): number {
  const s = a ?? "";
  const t = b ?? "";
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const rows = s.length + 1;
  const cols = t.length + 1;
  const prev = new Array<number>(cols);
  const curr = new Array<number>(cols);
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i < rows; i++) {
    curr[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j < cols; j++) prev[j] = curr[j]!;
  }
  return prev[t.length]!;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
