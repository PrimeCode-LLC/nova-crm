import { FieldValue, Timestamp, type DocumentData } from "@/lib/db/document-shim/shim-firestore";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import type { OrgMemberRole, ScriptCategory, ScriptLibraryItem } from "@/lib/types";
import { roleAtLeast } from "./org-role";

const SCRIPT_CATEGORIES: ScriptCategory[] = [
  "pitch",
  "rebuttal",
  "email_template",
  "call_script",
  "meeting_agenda",
  "followup_template",
  "other",
];

function tsToIso(t: Timestamp | undefined | null): string {
  if (!t || !t.toDate) return new Date().toISOString();
  return t.toDate().toISOString();
}

function docToScript(id: string, data: DocumentData): ScriptLibraryItem {
  const primaryText = String(data.primaryText ?? data.content ?? "");
  const secondaryText =
    typeof data.secondaryText === "string" ? data.secondaryText : "";
  return {
    id,
    organizationId: String(data.organizationId ?? ""),
    ownerUid: String(data.ownerUid ?? ""),
    ownerName: typeof data.ownerName === "string" ? data.ownerName : undefined,
    title: String(data.title ?? ""),
    category: SCRIPT_CATEGORIES.includes(data.category as ScriptCategory)
      ? (data.category as ScriptCategory)
      : "other",
    primaryText,
    secondaryText,
    content:
      String(data.content ?? "").trim() ||
      [primaryText, secondaryText].filter(Boolean).join("\n\n"),
    tags: Array.isArray(data.tags)
      ? data.tags.map((t: unknown) => String(t).trim()).filter(Boolean)
      : [],
    createdAt: tsToIso(data.createdAt as Timestamp | undefined),
    updatedAt: tsToIso(data.updatedAt as Timestamp | undefined),
  };
}

export async function listScriptsServer(input: {
  organizationId: string;
  actorUid: string;
  actorRole: OrgMemberRole;
}): Promise<ScriptLibraryItem[]> {
  const db = getAdminDb();
  if (!db) return [];
  let q = db
    .collection(COLLECTIONS.scriptLibrary)
    .where("organizationId", "==", input.organizationId);
  if (!roleAtLeast(input.actorRole, "admin")) {
    q = q.where("ownerUid", "==", input.actorUid);
  }
  const snap = await q.get();
  const items = snap.docs.map((d) => docToScript(d.id, d.data()));
  items.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  return items;
}

export async function createScriptServer(input: {
  organizationId: string;
  ownerUid: string;
  ownerName?: string;
  title: string;
  category: ScriptCategory;
  primaryText: string;
  secondaryText?: string;
  tags: string[];
}): Promise<{ script: ScriptLibraryItem } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };
  const primaryText = input.primaryText.trim();
  const secondaryText = (input.secondaryText ?? "").trim();
  const payload = {
    organizationId: input.organizationId,
    ownerUid: input.ownerUid,
    ownerName: input.ownerName ?? "",
    title: input.title.trim(),
    category: input.category,
    primaryText,
    secondaryText,
    content: [primaryText, secondaryText].filter(Boolean).join("\n\n"),
    tags: input.tags,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const ref = await db.collection(COLLECTIONS.scriptLibrary).add(payload);
  const fresh = await ref.get();
  return { script: docToScript(ref.id, fresh.data()!) };
}

export async function getScriptServer(id: string): Promise<ScriptLibraryItem | null> {
  const db = getAdminDb();
  if (!db) return null;
  const d = await db.collection(COLLECTIONS.scriptLibrary).doc(id).get();
  if (!d.exists) return null;
  return docToScript(d.id, d.data()!);
}

export async function updateScriptServer(input: {
  id: string;
  title?: string;
  category?: ScriptCategory;
  primaryText?: string;
  secondaryText?: string;
  tags?: string[];
}): Promise<{ script: ScriptLibraryItem } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };
  const ref = db.collection(COLLECTIONS.scriptLibrary).doc(input.id);
  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (typeof input.title === "string") updates.title = input.title.trim();
  if (typeof input.primaryText === "string") {
    updates.primaryText = input.primaryText.trim();
  }
  if (typeof input.secondaryText === "string") {
    updates.secondaryText = input.secondaryText.trim();
  }
  if (typeof input.category === "string") updates.category = input.category;
  if (Array.isArray(input.tags)) updates.tags = input.tags;
  if (
    typeof input.primaryText === "string" ||
    typeof input.secondaryText === "string"
  ) {
    const cur = await ref.get();
    const curData = cur.data() ?? {};
    const nextPrimary =
      typeof input.primaryText === "string"
        ? input.primaryText.trim()
        : String(curData.primaryText ?? curData.content ?? "");
    const nextSecondary =
      typeof input.secondaryText === "string"
        ? input.secondaryText.trim()
        : String(curData.secondaryText ?? "");
    updates.content = [nextPrimary, nextSecondary].filter(Boolean).join("\n\n");
  }
  await ref.update(updates);
  const fresh = await ref.get();
  if (!fresh.exists) return { error: "Script not found" };
  return { script: docToScript(fresh.id, fresh.data()!) };
}

export async function deleteScriptServer(id: string): Promise<{ ok: true } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };
  await db.collection(COLLECTIONS.scriptLibrary).doc(id).delete();
  return { ok: true };
}
