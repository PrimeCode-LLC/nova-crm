"use client";

import { doc, getDoc } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import { COLLECTIONS } from "@/lib/firestore/collections";
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
  const db = getFirebaseDb();
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
  if (!f.hasMessageBody) return f;
  const body = await fetchFollowupMessageBodyClient(f.id);
  if (body == null) return { ...f, hasMessageBody: false };
  return { ...f, messageBody: body, hasMessageBody: undefined };
}

export async function hydrateFollowupsMessageBodies(
  items: readonly Followup[],
): Promise<Followup[]> {
  return Promise.all(items.map((f) => hydrateFollowupMessageBody(f)));
}
