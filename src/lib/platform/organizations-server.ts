import {
  FieldValue,
  Timestamp,
  type DocumentData,
} from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
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

const TRIAL_DAYS = 14;

/** Firestore rejects `undefined`; omit empty optional strings. */
function settingsForFirestore(s: OrganizationSettings): Record<string, string> {
  const out: Record<string, string> = {};
  if (s.billingEmail?.trim()) out.billingEmail = s.billingEmail.trim();
  if (s.operatorNotes?.trim()) out.operatorNotes = s.operatorNotes.trim();
  if (s.inboundWebhookSecret?.trim()) {
    out.inboundWebhookSecret = s.inboundWebhookSecret.trim();
  }
  return out;
}

function tsToIso(t: Timestamp | undefined | null): ISODate {
  if (!t || !t.toDate) return new Date().toISOString();
  return t.toDate().toISOString();
}

function maybeTsToIso(t: Timestamp | undefined | null): ISODate | undefined {
  if (!t || !t.toDate) return undefined;
  return t.toDate().toISOString();
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
      custom.push({ id, name, description, stages, auto });
    }
  }

  return mergeChannelAdminConfig({
    autoMap: autoPartial,
    descriptionOverrides: descPartial,
    customChannels: custom,
  });
}

function docToOrg(id: string, data: DocumentData): Organization {
  const raw = (data.settings ?? {}) as Record<string, unknown>;
  const settings: OrganizationSettings = {
    billingEmail:
      typeof raw.billingEmail === "string" ? raw.billingEmail : undefined,
    operatorNotes:
      typeof raw.operatorNotes === "string" ? raw.operatorNotes : undefined,
    inboundWebhookSecret:
      typeof raw.inboundWebhookSecret === "string"
        ? raw.inboundWebhookSecret
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
    trialEndsAt: maybeTsToIso(data.trialEndsAt as Timestamp | undefined),
    settings,
    channelAdmin,
    intakeFilterDefaults,
    createdAt: tsToIso(data.createdAt as Timestamp | undefined),
    updatedAt: tsToIso(data.updatedAt as Timestamp | undefined),
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
  const { openJoinTokenHash: _h, channelAdmin: _ca, ...rest } = org;
  return {
    ...rest,
    settings: safeSettings,
    hasInboundWebhookSecret: Boolean(org.settings.inboundWebhookSecret?.trim()),
  };
}

export async function listOrganizationsServer(): Promise<Organization[]> {
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
  const db = getAdminDb();
  if (!db) return null;
  const ref = db.collection(COLLECTIONS.organizations).doc(orgId);
  const d = await ref.get();
  if (!d.exists) return null;
  return docToOrg(d.id, d.data()!);
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
  return { id: ref.id, slug };
}

export async function bumpOrganizationSeatsServer(
  orgId: string,
  delta: number,
): Promise<void> {
  const db = getAdminDb();
  if (!db) return;
  await db.collection(COLLECTIONS.organizations).doc(orgId).update({
    seatsUsed: FieldValue.increment(delta),
    updatedAt: FieldValue.serverTimestamp(),
  });
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
  const cur = await ref.get();
  if (!cur.exists) return { error: "Organization not found" };

  const updates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (patch.name !== undefined) updates.name = patch.name.trim();
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
    updates.slug = s;
  }
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

  await ref.update(updates);
  return { ok: true };
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
      descriptionOverrides: config.descriptionOverrides,
      customChannels: config.customChannels,
    },
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
}
