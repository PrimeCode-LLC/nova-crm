import { FieldValue, Timestamp, type DocumentData } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { isFirebaseWebConfiguredServer } from "@/lib/firebase/server-configured";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { CalendarConnection, CalendarProvider } from "@/lib/types";

export type CalendarGoogleConnectMethod = "firebase" | "oauth" | "none";

function tsToIso(t: Timestamp | undefined | null): string {
  if (!t || !t.toDate) return new Date().toISOString();
  return t.toDate().toISOString();
}

const PROVIDERS: CalendarProvider[] = ["google", "microsoft"];

function docToConnection(id: string, data: DocumentData): CalendarConnection {
  return {
    id,
    organizationId: String(data.organizationId ?? ""),
    ownerUid: String(data.ownerUid ?? ""),
    provider: PROVIDERS.includes(data.provider as CalendarProvider)
      ? (data.provider as CalendarProvider)
      : "google",
    accountEmail: String(data.accountEmail ?? ""),
    checkCalendarLabel: typeof data.checkCalendarLabel === "string" ? data.checkCalendarLabel : undefined,
    writeCalendarLabel: typeof data.writeCalendarLabel === "string" ? data.writeCalendarLabel : undefined,
    includeBuffers: data.includeBuffers !== false,
    syncExternalChanges: Boolean(data.syncExternalChanges),
    status:
      data.status === "error" || data.status === "disconnected"
        ? data.status
        : "connected",
    lastSyncAt: data.lastSyncAt ? tsToIso(data.lastSyncAt as Timestamp) : undefined,
    createdAt: tsToIso(data.createdAt as Timestamp | undefined),
    updatedAt: tsToIso(data.updatedAt as Timestamp | undefined),
  };
}

export function calendarOAuthConfigured(): {
  google: boolean;
  microsoft: boolean;
  googleMethod: CalendarGoogleConnectMethod;
} {
  const dedicatedGoogle = Boolean(
    process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim(),
  );
  const firebaseGoogle = isFirebaseWebConfiguredServer();
  return {
    google: dedicatedGoogle || firebaseGoogle,
    googleMethod: dedicatedGoogle ? "oauth" : firebaseGoogle ? "firebase" : "none",
    microsoft: Boolean(
      process.env.MICROSOFT_CALENDAR_CLIENT_ID?.trim() &&
        process.env.MICROSOFT_CALENDAR_CLIENT_SECRET?.trim(),
    ),
  };
}

export async function listCalendarConnectionsServer(input: {
  organizationId: string;
  ownerUid: string;
}): Promise<CalendarConnection[]> {
  const db = getAdminDb();
  if (!db) return [];
  const snap = await db
    .collection(COLLECTIONS.calendarConnections)
    .where("organizationId", "==", input.organizationId)
    .where("ownerUid", "==", input.ownerUid)
    .where("status", "==", "connected")
    .get();
  return snap.docs.map((d) => docToConnection(d.id, d.data()));
}

export async function upsertCalendarConnectionServer(input: {
  organizationId: string;
  ownerUid: string;
  provider: CalendarProvider;
  accountEmail: string;
  refreshToken?: string;
  accessToken?: string;
  tokenExpiresAt?: string;
}): Promise<{ connection: CalendarConnection } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };

  const existing = await db
    .collection(COLLECTIONS.calendarConnections)
    .where("organizationId", "==", input.organizationId)
    .where("ownerUid", "==", input.ownerUid)
    .where("provider", "==", input.provider)
    .where("accountEmail", "==", input.accountEmail)
    .limit(1)
    .get();

  const payload: Record<string, unknown> = {
    organizationId: input.organizationId,
    ownerUid: input.ownerUid,
    provider: input.provider,
    accountEmail: input.accountEmail,
    checkCalendarLabel: "Primary calendar",
    writeCalendarLabel: "Primary calendar",
    includeBuffers: true,
    syncExternalChanges: false,
    status: "connected",
    lastSyncAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (input.refreshToken) payload.refreshToken = input.refreshToken;
  if (input.accessToken) payload.accessToken = input.accessToken;
  if (input.tokenExpiresAt) payload.tokenExpiresAt = input.tokenExpiresAt;

  if (existing.empty) {
    payload.createdAt = FieldValue.serverTimestamp();
    const ref = await db.collection(COLLECTIONS.calendarConnections).add(payload);
    const fresh = await ref.get();
    return { connection: docToConnection(ref.id, fresh.data()!) };
  }

  const ref = existing.docs[0]!.ref;
  await ref.update(payload);
  const fresh = await ref.get();
  return { connection: docToConnection(ref.id, fresh.data()!) };
}

export async function disconnectCalendarConnectionServer(input: {
  organizationId: string;
  ownerUid: string;
  id: string;
}): Promise<{ ok: true } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };
  const ref = db.collection(COLLECTIONS.calendarConnections).doc(input.id);
  const snap = await ref.get();
  if (!snap.exists) return { error: "Connection not found" };
  const data = snap.data()!;
  if (
    String(data.organizationId) !== input.organizationId ||
    String(data.ownerUid) !== input.ownerUid
  ) {
    return { error: "Connection not found" };
  }
  await ref.update({
    status: "disconnected",
    refreshToken: FieldValue.delete(),
    accessToken: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
}

export async function updateCalendarConnectionSettingsServer(input: {
  organizationId: string;
  ownerUid: string;
  id: string;
  includeBuffers?: boolean;
  syncExternalChanges?: boolean;
}): Promise<{ connection: CalendarConnection } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };
  const ref = db.collection(COLLECTIONS.calendarConnections).doc(input.id);
  const snap = await ref.get();
  if (!snap.exists) return { error: "Connection not found" };
  const data = snap.data()!;
  if (
    String(data.organizationId) !== input.organizationId ||
    String(data.ownerUid) !== input.ownerUid
  ) {
    return { error: "Connection not found" };
  }
  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (input.includeBuffers !== undefined) patch.includeBuffers = input.includeBuffers;
  if (input.syncExternalChanges !== undefined) {
    patch.syncExternalChanges = input.syncExternalChanges;
  }
  await ref.update(patch);
  const fresh = await ref.get();
  return { connection: docToConnection(ref.id, fresh.data()!) };
}
