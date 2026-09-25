import {
  FieldValue,
  Timestamp,
  type DocumentData,
} from "@/lib/db/document-shim/shim-firestore";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { CHANNELS } from "@/lib/constants";
import type {
  ChannelKey,
  ISODate,
  Organization,
  OrganizationChannelAdminConfig,
  OrganizationCustomChannelRow,
  OrganizationIntakeFilterDefaults,
  OrganizationSettings,
  OrganizationStatus,
  SaaSPlanId,
} from "@/lib/types";
import { mergeChannelAdminConfig } from "@/lib/channel-admin-defaults";
import { parseIntakeFilterDefaults } from "@/lib/intake/intake-filter-defaults";
import { slugifyOrganizationName } from "@/lib/platform/slug";
import { parseOrgSendPolicy } from "@/lib/email/org-send-policy";
import { mirrorOrganizationAfterWrite } from "@/lib/db/dual-write-orgs";
import { parseIntentPlaybook } from "@/lib/intent/parse-playbook";

const TRIAL_DAYS = 14;

/** Firestore rejects `undefined`; omit empty optional strings. */
function settingsForFirestore(s: OrganizationSettings): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (s.billingEmail?.trim()) out.billingEmail = s.billingEmail.trim();
  if (s.timezone?.trim()) out.timezone = s.timezone.trim();
  if (s.sendPolicy) out.sendPolicy = s.sendPolicy;
  if (s.operatorNotes?.trim()) out.operatorNotes = s.operatorNotes.trim();
  if (s.inboundWebhookSecret?.trim()) {
    out.inboundWebhookSecret = s.inboundWebhookSecret.trim();
  }
  if (s.instantlyWebhookSecret?.trim()) {
    out.instantlyWebhookSecret = s.instantlyWebhookSecret.trim();
  }
  return out;
}

function tsToIso(t: Timestamp | Date | undefined | null): ISODate {
  if (!t) return new Date().toISOString();
  if (t instanceof Date) return t.toISOString();
  if (typeof (t as Timestamp).toDate === "function") {
    return (t as Timestamp).toDate().toISOString();
  }
  return new Date().toISOString();
}

function maybeTsToIso(t: Timestamp | Date | undefined | null): ISODate | undefined {
  if (!t) return undefined;
  if (t instanceof Date) return t.toISOString();
  if (typeof (t as Timestamp).toDate === "function") {
    return (t as Timestamp).toDate().toISOString();
  }
  return undefined;
}

const CHANNEL_KEY_SET = new Set(Object.keys(CHANNELS) as ChannelKey[]);

function parseOrgChannelAdmin(raw: unknown): OrganizationChannelAdminConfig | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;

  const autoPartial: Partial<Record<ChannelKey, boolean>> = {};
  if (o.autoMap && typeof o.autoMap === "object") {
    for (const [k, v] of Object.entries(o.autoMap as Record<string, unknown>)) {
      if (CHANNEL_KEY_SET.has(k as ChannelKey) && typeof v === "boolean") {
        autoPartial[k as ChannelKey] = v;
      }
    }
  }

  const enabledPartial: Partial<Record<ChannelKey, boolean>> = {};
  if (o.enabledMap && typeof o.enabledMap === "object") {
    for (const [k, v] of Object.entries(o.enabledMap as Record<string, unknown>)) {
      if (CHANNEL_KEY_SET.has(k as ChannelKey) && typeof v === "boolean") {
        enabledPartial[k as ChannelKey] = v;
      }
    }
  }

  const descPartial: Partial<Record<ChannelKey, string>> = {};
  if (o.descriptionOverrides && typeof o.descriptionOverrides === "object") {
    for (const [k, v] of Object.entries(
      o.descriptionOverrides as Record<string, unknown>,
    )) {
      if (CHANNEL_KEY_SET.has(k as ChannelKey) && typeof v === "string") {
        descPartial[k as ChannelKey] = v;
      }
    }
  }

  const custom: OrganizationCustomChannelRow[] = [];
  if (Array.isArray(o.customChannels)) {
    for (const row of o.customChannels) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id : "";
      const name = typeof r.name === "string" ? r.name : "";
      if (!id || !name.trim()) continue;
      const description = typeof r.description === "string" ? r.description : "";
      const auto = typeof r.auto === "boolean" ? r.auto : false;
      const enabled = typeof r.enabled === "boolean" ? r.enabled : true;
      const stages: { key: string; label: string }[] = [];
      if (Array.isArray(r.stages)) {
        for (const s of r.stages) {
          if (!s || typeof s !== "object") continue;
          const st = s as Record<string, unknown>;
          const sk = typeof st.key === "string" ? st.key : "";
          const label = typeof st.label === "string" ? st.label : "";
          if (sk && label) stages.push({ key: sk, label });
        }
      }
      custom.push({ id, name, description, stages, auto, enabled });
    }
  }

  return mergeChannelAdminConfig({
    autoMap: autoPartial,
    enabledMap: enabledPartial,
    descriptionOverrides: descPartial,
    customChannels: custom,
  });
}

function docToOrg(id: string, data: DocumentData): Organization {
  const raw = (data.settings ?? {}) as Record<string, unknown>;
  const settings: OrganizationSettings = {
    billingEmail:
      typeof raw.billingEmail === "string" ? raw.billingEmail : undefined,
    timezone: typeof raw.timezone === "string" ? raw.timezone : undefined,
    sendPolicy: parseOrgSendPolicy(raw.sendPolicy),
    operatorNotes:
      typeof raw.operatorNotes === "string" ? raw.operatorNotes : undefined,
    inboundWebhookSecret:
      typeof raw.inboundWebhookSecret === "string"
        ? raw.inboundWebhookSecret
        : undefined,
    instantlyWebhookSecret:
      typeof raw.instantlyWebhookSecret === "string"
        ? raw.instantlyWebhookSecret
        : undefined,
  };
  const channelAdminRaw = data.channelAdmin;
  const channelAdmin =
    channelAdminRaw !== undefined && channelAdminRaw !== null
      ? parseOrgChannelAdmin(channelAdminRaw)
      : undefined;
  const intakeFilterDefaults =
    data.intakeFilterDefaults !== undefined && data.intakeFilterDefaults !== null
      ? parseIntakeFilterDefaults(data.intakeFilterDefaults)
      : undefined;

  return {
    id,
    name: String(data.name ?? ""),
    slug: String(data.slug ?? id),
    status: (data.status as OrganizationStatus) ?? "trial",
    planId: (data.planId as SaaSPlanId) ?? "free",
    maxUsers: typeof data.maxUsers === "number" ? data.maxUsers : undefined,
    seatsUsed: typeof data.seatsUsed === "number" ? data.seatsUsed : undefined,
    ownerUid: typeof data.ownerUid === "string" ? data.ownerUid : undefined,
    primaryEmail:
      typeof data.primaryEmail === "string" ? data.primaryEmail : undefined,
    pendingOwnerEmail:
      typeof data.pendingOwnerEmail === "string"
        ? data.pendingOwnerEmail
        : undefined,
    trialEndsAt: maybeTsToIso(data.trialEndsAt as Timestamp | Date | undefined),
    settings,
    channelAdmin,
    intakeFilterDefaults,
    intakePoolEpoch:
      typeof data.intakePoolEpoch === "number" &&
      Number.isFinite(data.intakePoolEpoch) &&
      data.intakePoolEpoch >= 1
        ? Math.floor(data.intakePoolEpoch)
        : undefined,
    intentPlaybook:
      data.intentPlaybook !== undefined && data.intentPlaybook !== null
        ? parseIntentPlaybook(data.intentPlaybook)
        : undefined,
    createdAt: tsToIso(data.createdAt as Timestamp | Date | undefined),
    updatedAt: tsToIso(data.updatedAt as Timestamp | Date | undefined),
    openJoinTokenHash:
      typeof data.openJoinTokenHash === "string" && data.openJoinTokenHash
        ? data.openJoinTokenHash
        : undefined,
  };
}

/** Strips secrets before returning orgs to browser-facing JSON APIs. */
export function sanitizeOrganizationForApi(org: Organization): Organization {
  const safeSettings: OrganizationSettings = { ...org.settings };
  delete safeSettings.inboundWebhookSecret;
  delete safeSettings.instantlyWebhookSecret;
  const { openJoinTokenHash: _h, channelAdmin: _ca, ...rest } = org;
  return {
    ...rest,
    settings: safeSettings,
    hasInboundWebhookSecret: Boolean(org.settings.inboundWebhookSecret?.trim()),
  };
}

export async function listOrganizationsServer(): Promise<Organization[]> {
  try {
    const { isDatabaseConfigured } = await import("@/lib/db/prisma");
    if (isDatabaseConfigured()) {
      const { withRlsBypass } = await import("@/lib/db/tenant-scope");
      const rows = await withRlsBypass(async (tx) =>
        tx.organization.findMany({
          orderBy: { updatedAt: "desc" },
          take: 200,
        }),
      );
      return rows.map((row) =>
        docToOrg(row.id, {
          name: row.name,
          slug: row.slug,
          status: row.status,
          planId: row.planId,
          maxUsers: row.maxUsers ?? undefined,
          seatsUsed: row.seatsUsed,
          ownerUid: row.ownerUid ?? undefined,
          primaryEmail: row.primaryEmail ?? undefined,
          pendingOwnerEmail: row.pendingOwnerEmail ?? undefined,
          trialEndsAt: row.trialEndsAt ?? undefined,
          settings: row.settings ?? {},
          channelAdmin: row.channelAdmin ?? undefined,
          intakeFilterDefaults: row.intakeFilterDefaults ?? undefined,
          intakePoolEpoch: row.intakePoolEpoch,
          intentPlaybook: row.intentPlaybook ?? undefined,
          openJoinTokenHash: row.openJoinTokenHash ?? undefined,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }),
      );
    }
  } catch (err) {
    console.warn(
      "[orgs] listOrganizationsServer postgres lookup failed",
      err instanceof Error ? err.message : err,
    );
  }

  // Legacy fallback — org roots are no longer mirrored into pg_documents after
  // the organizations-table cutover (0 root docs); keep for empty-DB bootstraps.
  const db = getAdminDb();
  if (!db) return [];
  const snap = await db
    .collection(COLLECTIONS.organizations)
    .orderBy("updatedAt", "desc")
    .limit(200)
    .get();
  return snap.docs.map((d) => docToOrg(d.id, d.data()));
}

export async function getOrganizationServer(
  orgId: string,
): Promise<Organization | null> {
  try {
    const { isDatabaseConfigured } = await import("@/lib/db/prisma");
    if (isDatabaseConfigured()) {
      const { withRlsBypass } = await import("@/lib/db/tenant-scope");
      const row = await withRlsBypass(async (tx) =>
        tx.organization.findUnique({ where: { id: orgId } }),
      );
      if (row) {
        return docToOrg(row.id, {
          name: row.name,
          slug: row.slug,
          status: row.status,
          planId: row.planId,
          maxUsers: row.maxUsers ?? undefined,
          seatsUsed: row.seatsUsed,
          ownerUid: row.ownerUid ?? undefined,
          primaryEmail: row.primaryEmail ?? undefined,
          pendingOwnerEmail: row.pendingOwnerEmail ?? undefined,
          trialEndsAt: row.trialEndsAt ?? undefined,
          settings: row.settings ?? {},
          channelAdmin: row.channelAdmin ?? undefined,
          intakeFilterDefaults: row.intakeFilterDefaults ?? undefined,
          intakePoolEpoch: row.intakePoolEpoch,
          intentPlaybook: row.intentPlaybook ?? undefined,
          openJoinTokenHash: row.openJoinTokenHash ?? undefined,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        });
      }
    }
  } catch (err) {
    console.warn(
      "[orgs] getOrganizationServer postgres lookup failed",
      err instanceof Error ? err.message : err,
    );
  }

  const db = getAdminDb();
  if (!db) return null;
  const ref = db.collection(COLLECTIONS.organizations).doc(orgId);
  const d = await ref.get();
  if (!d.exists) return null;
  return docToOrg(d.id, d.data()!);
}

/**
 * Seat bumps and member writes require an organizations/{id} document.
 * Postgres-first orgs (migration / mirror lag) may only exist in SQL —
 * hydrate the document store from getOrganizationServer before mutating seats.
 */
export async function ensureOrganizationDocumentStoreServer(
  orgId: string,
): Promise<{ ok: true } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };
  const ref = db.collection(COLLECTIONS.organizations).doc(orgId);
  const existing = await ref.get();
  if (existing.exists) return { ok: true };

  const org = await getOrganizationServer(orgId);
  if (!org) return { error: "Organization not found" };

  const payload: Record<string, unknown> = {
    name: org.name,
    slug: org.slug,
    status: org.status,
    planId: org.planId,
    seatsUsed: org.seatsUsed ?? 0,
    settings: settingsForFirestore(org.settings ?? {}),
    intakePoolEpoch: org.intakePoolEpoch ?? 1,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (org.maxUsers != null) payload.maxUsers = org.maxUsers;
  if (org.ownerUid) payload.ownerUid = org.ownerUid;
  if (org.primaryEmail) payload.primaryEmail = org.primaryEmail;
  if (org.pendingOwnerEmail) payload.pendingOwnerEmail = org.pendingOwnerEmail;
  if (org.trialEndsAt) payload.trialEndsAt = new Date(org.trialEndsAt);
  if (org.channelAdmin) payload.channelAdmin = org.channelAdmin;
  if (org.intakeFilterDefaults) {
    payload.intakeFilterDefaults = org.intakeFilterDefaults;
  }
  if (org.intentPlaybook) payload.intentPlaybook = org.intentPlaybook;
  if (org.openJoinTokenHash) payload.openJoinTokenHash = org.openJoinTokenHash;
  if (org.createdAt) payload.createdAt = new Date(org.createdAt);

  await ref.set(payload, { merge: true });
  return { ok: true };
}

export async function findOrganizationByPendingEmailServer(
  email: string,
): Promise<Organization | null> {
  const db = getAdminDb();
  if (!db) return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const snap = await db
    .collection(COLLECTIONS.organizations)
    .where("pendingOwnerEmail", "==", normalized)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const d = snap.docs[0]!;
  return docToOrg(d.id, d.data());
}

export async function claimPendingOrgOwnerServer(
  orgId: string,
  uid: string,
  email: string,
): Promise<{ ok: true } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };
  const ref = db.collection(COLLECTIONS.organizations).doc(orgId);
  const snap = await ref.get();
  if (!snap.exists) return { error: "Organization not found" };
  const data = snap.data() ?? {};
  if (data.ownerUid && data.ownerUid !== uid) {
    return { error: "Organization already has an owner" };
  }
  await ref.update({
    ownerUid: uid,
    primaryEmail: email.toLowerCase(),
    pendingOwnerEmail: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await mirrorOrganizationAfterWrite(orgId);
  return { ok: true };
}

export async function createOrganizationServer(input: {
  name: string;
  slug?: string;
  status?: OrganizationStatus;
  planId?: SaaSPlanId;
  maxUsers?: number;
  /** When set, the org is created in `trial` status with this email recorded as the future owner. */
  pendingOwnerEmail?: string;
  /** When set, this uid is stamped as `ownerUid` immediately (used by signup self-create). */
  ownerUid?: string;
  ownerEmail?: string;
  settings?: OrganizationSettings;
}): Promise<{ id: string; slug: string } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };

  const name = input.name.trim();
  if (!name) return { error: "Name is required" };

  let slug = (input.slug ?? slugifyOrganizationName(name)).toLowerCase();
  slug = slug.replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "") || "org";

  const dup = await db
    .collection(COLLECTIONS.organizations)
    .where("slug", "==", slug)
    .limit(1)
    .get();
  if (!dup.empty) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }

  const ref = db.collection(COLLECTIONS.organizations).doc();
  const settings = settingsForFirestore(input.settings ?? {});
  const trialEnds = Timestamp.fromMillis(
    Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000,
  );
  const payload: Record<string, unknown> = {
    name,
    slug,
    status: input.status ?? "trial",
    planId: input.planId ?? "free",
    maxUsers: input.maxUsers ?? null,
    seatsUsed: input.ownerUid ? 1 : 0,
    settings,
    trialEndsAt: trialEnds,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (input.ownerUid) payload.ownerUid = input.ownerUid;
  if (input.ownerEmail) payload.primaryEmail = input.ownerEmail.toLowerCase();
  if (input.pendingOwnerEmail) {
    payload.pendingOwnerEmail = input.pendingOwnerEmail.toLowerCase();
  }
  await ref.set(payload);
  await mirrorOrganizationAfterWrite(ref.id);
  return { id: ref.id, slug };
}

export async function bumpOrganizationSeatsServer(
  orgId: string,
  delta: number,
  opts?: { enforceMax?: boolean },
): Promise<{ ok: true; seatsUsed: number } | { ok: false; error: string }> {
  const db = getAdminDb();
  if (!db) return { ok: false, error: "Database not configured" };

  const ensured = await ensureOrganizationDocumentStoreServer(orgId);
  if ("error" in ensured) return { ok: false, error: ensured.error };

  const ref = db.collection(COLLECTIONS.organizations).doc(orgId);
  try {
    const seatsUsed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Organization not found");
      const data = snap.data() as {
        seatsUsed?: unknown;
        maxUsers?: unknown;
      };
      const used = Math.max(0, Number(data.seatsUsed ?? 0));
      const max =
        data.maxUsers == null || data.maxUsers === ""
          ? null
          : Number(data.maxUsers);
      if (
        opts?.enforceMax &&
        delta > 0 &&
        max != null &&
        Number.isFinite(max) &&
        used + delta > max
      ) {
        throw new Error(
          `Seat limit reached (${used}/${max}). Upgrade plan or remove an inactive member.`,
        );
      }
      const next = Math.max(0, used + delta);
      tx.update(ref, {
        seatsUsed: next,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return next;
    });
    await mirrorOrganizationAfterWrite(orgId);
    return { ok: true, seatsUsed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export async function updateOrganizationServer(
  orgId: string,
  patch: {
    name?: string;
    slug?: string;
    status?: OrganizationStatus;
    planId?: SaaSPlanId;
    maxUsers?: number | null;
    settings?: OrganizationSettings;
  },
): Promise<{ ok: true } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };

  const ref = db.collection(COLLECTIONS.organizations).doc(orgId);

  // Slug uniqueness is checked outside the org-doc lock (cross-doc). Re-check
  // inside the transaction that the org still exists before writing.
  let nextSlug: string | undefined;
  if (patch.slug !== undefined) {
    const s = patch.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!s) return { error: "Invalid slug" };
    const dup = await db
      .collection(COLLECTIONS.organizations)
      .where("slug", "==", s)
      .limit(2)
      .get();
    const clash = dup.docs.some((d) => d.id !== orgId);
    if (clash) return { error: "Slug already in use" };
    nextSlug = s;
  }

  try {
    await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      if (!cur.exists) throw new Error("Organization not found");

      const updates: Record<string, unknown> = {
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (patch.name !== undefined) updates.name = patch.name.trim();
      if (nextSlug !== undefined) updates.slug = nextSlug;
      if (patch.status !== undefined) updates.status = patch.status;
      if (patch.planId !== undefined) updates.planId = patch.planId;
      if (patch.maxUsers !== undefined) {
        updates.maxUsers = patch.maxUsers === null ? null : patch.maxUsers;
      }
      if (patch.settings !== undefined) {
        const prevSettings = docToOrg(orgId, cur.data()!).settings;
        const merged: OrganizationSettings = { ...prevSettings };
        const incoming = patch.settings as Partial<OrganizationSettings>;
        for (const k of Object.keys(incoming) as (keyof OrganizationSettings)[]) {
          if (!Object.prototype.hasOwnProperty.call(incoming, k)) continue;
          const v = incoming[k];
          if (v === undefined) continue;
          if (typeof v === "string" && v.trim() === "") {
            delete merged[k];
          } else {
            merged[k] = v as never;
          }
        }
        updates.settings = settingsForFirestore(merged);
      }

      tx.update(ref, updates);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }

  await mirrorOrganizationAfterWrite(orgId);
  return { ok: true };
}

export async function archiveOrganizationServer(
  orgId: string,
): Promise<{ ok: true } | { error: string }> {
  return updateOrganizationServer(orgId, { status: "archived" });
}

export async function bulkUpdateOrganizationsServer(input: {
  orgIds: string[];
  status: OrganizationStatus;
}): Promise<{ updated: number; errors: string[] }> {
  let updated = 0;
  const errors: string[] = [];
  for (const orgId of input.orgIds) {
    const result = await updateOrganizationServer(orgId, { status: input.status });
    if ("error" in result) {
      errors.push(`${orgId}: ${result.error}`);
    } else {
      updated += 1;
    }
  }
  return { updated, errors };
}

export async function findUnnamedOrganizationIds(): Promise<string[]> {
  const orgs = await listOrganizationsServer();
  return orgs
    .filter((o) => !o.name?.trim() && o.status !== "archived")
    .map((o) => o.id);
}

export async function updateOrganizationChannelAdminServer(
  orgId: string,
  config: OrganizationChannelAdminConfig,
): Promise<{ ok: true } | { error: string }> {
  const db = getAdminDb();
  if (!db) return { error: "Database not configured" };

  const ref = db.collection(COLLECTIONS.organizations).doc(orgId);
  const cur = await ref.get();
  if (!cur.exists) return { error: "Organization not found" };

  await ref.update({
    channelAdmin: {
      autoMap: config.autoMap,
      enabledMap: config.enabledMap,
      descriptionOverrides: config.descriptionOverrides,
      customChannels: config.customChannels,
    },
    updatedAt: FieldValue.serverTimestamp(),
  });
  await mirrorOrganizationAfterWrite(orgId);
  return { ok: true };
}
