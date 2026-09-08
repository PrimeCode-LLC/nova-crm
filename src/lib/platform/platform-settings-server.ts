import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { ISODate, PlatformOpsSettings } from "@/lib/types";

export const PLATFORM_SETTINGS_DOC_ID = "global" as const;

/** Short TTL so crons / layouts don’t hammer Firestore on every tick. */
const CACHE_TTL_MS = 15_000;

let cache: { at: number; value: PlatformOpsSettings } | null = null;

function tsToIso(v: { toDate?: () => Date } | undefined): ISODate | undefined {
  if (!v?.toDate) return undefined;
  return v.toDate().toISOString();
}

function envForcesBackupOnly(): boolean {
  const v = process.env.PLATFORM_BACKUP_ONLY?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function invalidatePlatformSettingsCache(): void {
  cache = null;
}

export async function getPlatformOpsSettingsServer(): Promise<PlatformOpsSettings> {
  if (envForcesBackupOnly()) {
    return {
      backupOnlyMode: true,
      backupOnlyReason: "PLATFORM_BACKUP_ONLY env override",
    };
  }

  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }

  const db = getAdminDb();
  if (!db) {
    const empty: PlatformOpsSettings = { backupOnlyMode: false };
    cache = { at: now, value: empty };
    return empty;
  }

  const snap = await db
    .collection(COLLECTIONS.platformSettings)
    .doc(PLATFORM_SETTINGS_DOC_ID)
    .get();

  const raw = snap.exists ? snap.data() : undefined;
  const value: PlatformOpsSettings = {
    backupOnlyMode: raw?.backupOnlyMode === true,
    backupOnlyReason:
      typeof raw?.backupOnlyReason === "string" && raw.backupOnlyReason.trim()
        ? raw.backupOnlyReason.trim()
        : undefined,
    updatedAt: tsToIso(raw?.updatedAt),
    updatedByUid:
      typeof raw?.updatedByUid === "string" ? raw.updatedByUid : undefined,
  };

  cache = { at: now, value };
  return value;
}

/** True when automation + live spend should stop (env override or Firestore flag). */
export async function isBackupOnlyModeEnabled(): Promise<boolean> {
  const s = await getPlatformOpsSettingsServer();
  return s.backupOnlyMode === true;
}

export async function setBackupOnlyModeServer(input: {
  enabled: boolean;
  reason?: string;
  actorUid: string;
}): Promise<PlatformOpsSettings> {
  if (envForcesBackupOnly() && !input.enabled) {
    throw new Error(
      "Cannot disable Backup only while PLATFORM_BACKUP_ONLY is set in the environment.",
    );
  }

  const db = getAdminDb();
  if (!db) throw new Error("Database not configured");

  const ref = db.collection(COLLECTIONS.platformSettings).doc(PLATFORM_SETTINGS_DOC_ID);
  const reason = input.reason?.trim() || undefined;

  await ref.set(
    {
      backupOnlyMode: input.enabled,
      backupOnlyReason: input.enabled ? reason ?? null : FieldValue.delete(),
      updatedByUid: input.actorUid,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  invalidatePlatformSettingsCache();
  return getPlatformOpsSettingsServer();
}
