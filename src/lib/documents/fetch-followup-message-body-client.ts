"use client";

import { doc, getDoc } from "@/lib/db/document-shim/shim-client-firestore";
import { getClientDb } from "@/lib/db/document-access/client";
import { COLLECTIONS } from "@/lib/documents/collections";
import type { Followup } from "@/lib/types";

/**
 * Live workspace snapshots omit `messageBody` to keep CRM state light.
 * Call this before scheduling/editing when `hasMessageBody` is set (or body is empty).
 */
export async function fetchFollowupMessageBodyClient(
  followupId: string,
): Promise<string | undefined> {
  const id = followupId.trim();
  if (!id) return undefined;
  const db = getClientDb();
  try {
    const snap = await getDoc(doc(db, COLLECTIONS.followups, id));
    if (!snap.exists()) return undefined;
    const raw = snap.data() as Record<string, unknown>;
    return typeof raw.messageBody === "string" ? raw.messageBody : undefined;
  } catch (e) {
    const code =
      e && typeof e === "object" && "code" in e
        ? String((e as { code: unknown }).code)
        : "";
    if (code === "permission-denied") {
      throw new Error(
        "Missing or insufficient permissions to load this follow-up email body.",
      );
    }
    throw e;
  }
}

/** Returns a followup with `messageBody` filled from Firestore when it was omitted from live state. */
export async function hydrateFollowupMessageBody(f: Followup): Promise<Followup> {
  if (f.messageBody?.trim()) return f;
  // Prefer hasMessageBody; also try when we only have a subject (heals stale live rows
  // that lost the flag after list projection stripped the body).
  if (!f.hasMessageBody && !f.emailSubject?.trim()) return f;
  const body = await fetchFollowupMessageBodyClient(f.id);
  if (body == null) return { ...f, hasMessageBody: false };
  return { ...f, messageBody: body, hasMessageBody: undefined };
}

/**
 * Compare a patched body to live CRM state. Live rows omit `messageBody`, so a
 * naive `!== existing.messageBody` always looks like a change and cancels schedules.
 */
export async function followupMessageBodyChanged(
  existing: Followup,
  nextBody: string | undefined,
): Promise<boolean> {
  const normalizedNext = nextBody?.trim() || undefined;
  if (existing.messageBody != null) {
    return normalizedNext !== (existing.messageBody.trim() || undefined);
  }
  if (!existing.hasMessageBody && !existing.emailSubject?.trim()) {
    return Boolean(normalizedNext);
  }
  const hydrated = await hydrateFollowupMessageBody(existing);
  return normalizedNext !== (hydrated.messageBody?.trim() || undefined);
}

export async function hydrateFollowupsMessageBodies(
  items: readonly Followup[],
): Promise<Followup[]> {
  return Promise.all(items.map((f) => hydrateFollowupMessageBody(f)));
}
