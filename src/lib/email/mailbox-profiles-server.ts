import { getAdminDb } from "@/lib/db/document-access/admin";
import { deleteDocumentSubtree } from "@/lib/db/document-shim/store";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
import type { EmailMailboxSettings, MailboxConnectionType } from "@/lib/email-account-types";
import {
  type MailLabel,
  parseLabelsByMessageIdFromFirestore,
  parseMailLabelsFromFirestore,
} from "@/lib/email/mail-labels";
import {
  type MailFlagId,
  parseFlagByMessageIdFromFirestore,
} from "@/lib/email/mail-flags";
import {
  deleteMailboxSecretsServer,
  getMailboxSecretsServer,
  googleAuthConnectedFromSecretsData,
  mailboxSecretDocRef,
  upsertMailboxSecretsServer,
} from "@/lib/email/mailbox-secrets-server";
import { listOrgUsersServer } from "@/lib/platform/hierarchy-access-server";
import { withGoogleWorkspaceConnection, withMicrosoftOutlookConnection } from "@/lib/email/mailbox-connection-presets";

const META_COLLECTION = "emailAccountState";
const META_DOC_ID = "default";

export type EmailAccountMeta = {
  activeMailboxId: string;
  linkedLeadByMessageId: Record<string, string>;
  /** Sender domains (e.g. `bark.com`) whose INBOX mail is auto-moved to Trash. */
  blockedSenderDomains: string[];
  /**
   * Plain-text footer appended after the mailbox signature on outbound followup /
   * sequence emails when the scheduler includes the footer (default on).
   */
  globalEmailFooter: string;
  /** User-defined inbox labels (Gmail-style). */
  mailLabels: MailLabel[];
  /** Message meta key → label ids assigned to that message. */
  labelsByMessageId: Record<string, string[]>;
  /** Message meta key → Apple Mail–style flag color id. */
  flagByMessageId: Record<string, MailFlagId>;
};

function memberRoot(orgId: string, uid: string) {
  const db = getAdminDb();
  if (!db) return null;
  return db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.members)
    .doc(uid);
}

function mailboxProfileRef(orgId: string, uid: string, mailboxId: string) {
  const root = memberRoot(orgId, uid);
  if (!root) return null;
  return root.collection("emailMailboxes").doc(mailboxId);
}

function metaRef(orgId: string, uid: string) {
  const root = memberRoot(orgId, uid);
  if (!root) return null;
  return root.collection(META_COLLECTION).doc(META_DOC_ID);
}

function parseConnectionType(raw: unknown): MailboxConnectionType {
  if (raw === "google_workspace") return "google_workspace";
  if (raw === "microsoft_outlook") return "microsoft_outlook";
  return "custom";
}

function serializeConnectionType(type: MailboxConnectionType): MailboxConnectionType {
  if (type === "google_workspace" || type === "microsoft_outlook") return type;
  return "custom";
}

function parseDailySendLimit(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function parseSendGapSeconds(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(120, Math.floor(n));
}

function parseAssignedUserIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
}

function profileToFirestore(mb: EmailMailboxSettings): Record<string, unknown> {
  return {
    label: mb.label,
    enabled: mb.enabled,
    displayName: mb.displayName,
    emailAddress: mb.emailAddress,
    replyTo: mb.replyTo,
    smtpHost: mb.smtp.host,
    smtpPort: mb.smtp.port,
    smtpSecure: mb.smtp.secure,
    imapHost: mb.imap.host,
    imapPort: mb.imap.port,
    imapSecure: mb.imap.secure,
    signature: mb.signature,
    syncIntervalMinutes: mb.syncIntervalMinutes,
    archiveOnSend: mb.archiveOnSend,
    readReceipts: mb.readReceipts,
    trackClicks: Boolean(mb.trackClicks),
    connectionType: serializeConnectionType(mb.connectionType),
    dailySendLimit: mb.dailySendLimit == null ? null : Math.floor(mb.dailySendLimit),
    sendGapSeconds:
      mb.sendGapSeconds == null ? null : parseSendGapSeconds(mb.sendGapSeconds),
    assignedUserIds: parseAssignedUserIds(mb.assignedUserIds),
    updatedAt: new Date().toISOString(),
  };
}

function firestoreToMailbox(
  mailboxId: string,
  data: Record<string, unknown>,
  secrets: {
    smtp: { user: string; password: string };
    imap: { user: string; password: string };
    googleOAuth?: { accountEmail: string; refreshToken?: string };
  } | null,
  options?: {
    dataOwnerUid?: string;
    stripSecrets?: boolean;
    /** When set, overrides vault-derived googleAuthConnected (lite hydrate). */
    googleAuthConnected?: boolean;
  },
): EmailMailboxSettings {
  const strip = Boolean(options?.stripSecrets);
  const smtpUser = strip ? "" : (secrets?.smtp.user ?? "");
  const smtpPassword = strip ? "" : (secrets?.smtp.password ?? "");
  const imapUser = strip ? "" : (secrets?.imap.user ?? "");
  const imapPassword = strip ? "" : (secrets?.imap.password ?? "");
  const googleEmail = secrets?.googleOAuth?.accountEmail?.trim() ?? "";
  const googleRefresh = secrets?.googleOAuth?.refreshToken?.trim() ?? "";
  const googleFromVault = Boolean(googleEmail && googleRefresh);
  const mailbox: EmailMailboxSettings = {
    id: mailboxId,
    label: String(data.label ?? "Mailbox"),
    enabled: Boolean(data.enabled),
    displayName: String(data.displayName ?? ""),
    emailAddress: String(data.emailAddress ?? ""),
    replyTo: String(data.replyTo ?? ""),
    smtp: {
      host: String(data.smtpHost ?? ""),
      port: Number(data.smtpPort ?? 587),
      secure: Boolean(data.smtpSecure),
      user: smtpUser,
      password: smtpPassword,
    },
    imap: {
      host: String(data.imapHost ?? ""),
      port: Number(data.imapPort ?? 993),
      secure: Boolean(data.imapSecure),
      user: imapUser,
      password: imapPassword,
    },
    signature: String(data.signature ?? ""),
    syncIntervalMinutes: Math.max(5, Number(data.syncIntervalMinutes ?? 15)),
    archiveOnSend: Boolean(data.archiveOnSend),
    readReceipts: Boolean(data.readReceipts),
    trackClicks: Boolean(data.trackClicks),
    connectionType: parseConnectionType(data.connectionType),
    dailySendLimit: parseDailySendLimit(data.dailySendLimit),
    sendGapSeconds: parseSendGapSeconds(data.sendGapSeconds),
    assignedUserIds: parseAssignedUserIds(data.assignedUserIds),
    // Require a refresh token — access-only / empty-token vault rows look "connected" but IMAP fails.
    googleAuthConnected:
      typeof options?.googleAuthConnected === "boolean"
        ? options.googleAuthConnected
        : googleFromVault,
    ...(typeof data.inboxLastSyncError === "string" && data.inboxLastSyncError.trim()
      ? { transportError: data.inboxLastSyncError.trim().slice(0, 500) }
      : {}),
    ...(typeof data.inboxLastSyncedAt === "string" && data.inboxLastSyncedAt.trim()
      ? { transportCheckedAt: data.inboxLastSyncedAt.trim() }
      : {}),
  };
  if (options?.dataOwnerUid) {
    mailbox.dataOwnerUid = options.dataOwnerUid;
  }
  return mailbox;
}

export async function getEmailAccountMetaServer(input: {
  organizationId: string;
  uid: string;
  /**
   * Skip per-message maps (often huge). Used for boot hydrate so dashboard
   * does not download / JSON-parse linkedLead / labels / flags maps.
   */
  lite?: boolean;
}): Promise<EmailAccountMeta> {
  const empty: EmailAccountMeta = {
    activeMailboxId: "",
    linkedLeadByMessageId: {},
    blockedSenderDomains: [],
    globalEmailFooter: "",
    mailLabels: [],
    labelsByMessageId: {},
    flagByMessageId: {},
  };
  const ref = metaRef(input.organizationId, input.uid);
  if (!ref) return empty;

  const db = getAdminDb();
  if (!db) return empty;

  // Field mask avoids pulling megabyte-scale message maps on every app open.
  // DocumentReference has no .select(); use Firestore#getAll fieldMask.
  const snap = input.lite
    ? (
        await db.getAll(ref, {
          fieldMask: [
            "activeMailboxId",
            "blockedSenderDomains",
            "globalEmailFooter",
            "mailLabels",
          ],
        })
      )[0]
    : await ref.get();
  if (!snap?.exists) return empty;

  const data = snap.data() as Record<string, unknown>;
  const active = String(data.activeMailboxId ?? "").trim();
  const blockedRaw = data.blockedSenderDomains;
  const blockedSenderDomains = Array.isArray(blockedRaw)
    ? blockedRaw.map((d) => String(d).trim().toLowerCase()).filter(Boolean)
    : [];
  const globalEmailFooter =
    typeof data.globalEmailFooter === "string" ? data.globalEmailFooter : "";
  const mailLabels = parseMailLabelsFromFirestore(data.mailLabels);

  if (input.lite) {
    return {
      ...empty,
      activeMailboxId: active,
      blockedSenderDomains,
      globalEmailFooter,
      mailLabels,
    };
  }

  const links = data.linkedLeadByMessageId;
  const linkedLeadByMessageId =
    links && typeof links === "object" && !Array.isArray(links)
      ? (links as Record<string, string>)
      : {};
  const labelsByMessageId = parseLabelsByMessageIdFromFirestore(data.labelsByMessageId);
  const flagByMessageId = parseFlagByMessageIdFromFirestore(data.flagByMessageId);
  return {
    activeMailboxId: active,
    linkedLeadByMessageId,
    blockedSenderDomains,
    globalEmailFooter,
    mailLabels,
    labelsByMessageId,
    flagByMessageId,
  };
}

export async function setEmailAccountMetaServer(input: {
  organizationId: string;
  uid: string;
  meta: Partial<EmailAccountMeta>;
}): Promise<{ ok: true } | { error: string }> {
  const ref = metaRef(input.organizationId, input.uid);
  if (!ref) return { error: "Database not configured" };
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (input.meta.activeMailboxId !== undefined) {
    patch.activeMailboxId = input.meta.activeMailboxId;
  }
  if (input.meta.linkedLeadByMessageId !== undefined) {
    patch.linkedLeadByMessageId = input.meta.linkedLeadByMessageId;
  }
  if (input.meta.blockedSenderDomains !== undefined) {
    patch.blockedSenderDomains = input.meta.blockedSenderDomains;
  }
  if (input.meta.globalEmailFooter !== undefined) {
    patch.globalEmailFooter = input.meta.globalEmailFooter;
  }
  if (input.meta.mailLabels !== undefined) {
    patch.mailLabels = input.meta.mailLabels;
  }
  if (input.meta.labelsByMessageId !== undefined) {
    patch.labelsByMessageId = input.meta.labelsByMessageId;
  }
  if (input.meta.flagByMessageId !== undefined) {
    patch.flagByMessageId = input.meta.flagByMessageId;
  }
  await ref.set(patch, { merge: true });
  return { ok: true };
}

export async function listMailboxesForMemberServer(input: {
  organizationId: string;
  uid: string;
  /**
   * When false (dashboard hydrate / inbound-heads), skip vault decrypts.
   * IMAP/SMTP routes resolve secrets server-side via mailboxId.
   * Default true for send/scheduled paths that still read passwords from the list.
   */
  includeSecrets?: boolean;
}): Promise<EmailMailboxSettings[]> {
  const root = memberRoot(input.organizationId, input.uid);
  if (!root) return [];
  const snap = await root.collection("emailMailboxes").get();
  const includeSecrets = input.includeSecrets !== false;

  if (!includeSecrets) {
    const db = getAdminDb();
    const googleConnectedById = new Map<string, boolean>();
    if (db && snap.docs.length > 0) {
      const refs = snap.docs
        .map((doc) => mailboxSecretDocRef(input.organizationId, input.uid, doc.id))
        .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref));
      for (let i = 0; i < refs.length; i += 100) {
        const chunk = refs.slice(i, i + 100);
        const secretSnaps = await db.getAll(...chunk);
        for (let j = 0; j < secretSnaps.length; j++) {
          const secretSnap = secretSnaps[j]!;
          const mailboxId = chunk[j]!.id;
          googleConnectedById.set(
            mailboxId,
            googleAuthConnectedFromSecretsData(
              secretSnap.exists ? (secretSnap.data() as Record<string, unknown>) : undefined,
            ),
          );
        }
      }
    }
    const out = snap.docs.map((doc) =>
      firestoreToMailbox(doc.id, doc.data() as Record<string, unknown>, null, {
        stripSecrets: true,
        googleAuthConnected: googleConnectedById.get(doc.id) ?? false,
      }),
    );
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }

  const out = await Promise.all(
    snap.docs.map(async (doc) => {
      const secrets = await getMailboxSecretsServer({
        organizationId: input.organizationId,
        uid: input.uid,
        mailboxId: doc.id,
      });
      return firestoreToMailbox(doc.id, doc.data() as Record<string, unknown>, secrets
        ? {
            smtp: secrets.smtp,
            imap: secrets.imap,
            googleOAuth: secrets.googleOAuth
              ? {
                  accountEmail: secrets.googleOAuth.accountEmail,
                  refreshToken: secrets.googleOAuth.refreshToken,
                }
              : undefined,
          }
        : null);
    }),
  );
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

export async function getMailboxProfileServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
}): Promise<EmailMailboxSettings | null> {
  const ref = mailboxProfileRef(input.organizationId, input.uid, input.mailboxId);
  if (!ref) return null;
  const snap = await ref.get();
  if (!snap.exists) return null;
  const secrets = await getMailboxSecretsServer(input);
  return firestoreToMailbox(
    snap.id,
    snap.data() as Record<string, unknown>,
    secrets
      ? {
          smtp: secrets.smtp,
          imap: secrets.imap,
          googleOAuth: secrets.googleOAuth
            ? {
                accountEmail: secrets.googleOAuth.accountEmail,
                refreshToken: secrets.googleOAuth.refreshToken,
              }
            : undefined,
        }
      : null,
  );
}

/** Mailboxes on other members where `assignedUserIds` includes the viewer (secrets stripped). */
export async function listMailboxesAssignedToViewerServer(input: {
  organizationId: string;
  viewerUid: string;
}): Promise<EmailMailboxSettings[]> {
  const db = getAdminDb();
  if (!db) return [];

  // Prefer one collection-group query over O(members) fan-out.
  try {
    const snap = await db
      .collectionGroup("emailMailboxes")
      .where("assignedUserIds", "array-contains", input.viewerUid)
      .get();
    const out: EmailMailboxSettings[] = [];
    for (const doc of snap.docs) {
      // organizations/{orgId}/members/{uid}/emailMailboxes/{mailboxId}
      const parts = doc.ref.path.split("/");
      if (
        parts.length < 6 ||
        parts[0] !== COLLECTIONS.organizations ||
        parts[1] !== input.organizationId ||
        parts[2] !== ORG_SUBCOLLECTIONS.members ||
        parts[4] !== "emailMailboxes"
      ) {
        continue;
      }
      const ownerUid = parts[3]!;
      if (!ownerUid || ownerUid === input.viewerUid) continue;
      out.push(
        firestoreToMailbox(doc.id, doc.data() as Record<string, unknown>, null, {
          dataOwnerUid: ownerUid,
          stripSecrets: true,
          googleAuthConnected: false,
        }),
      );
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  } catch {
    // Index / collection-group not ready — fall back to per-member scan.
  }

  const users = await listOrgUsersServer(input.organizationId);
  const others = users.filter((u) => u.id && u.id !== input.viewerUid);
  const chunks = await Promise.all(
    others.map(async (u) => {
      const root = memberRoot(input.organizationId, u.id);
      if (!root) return [] as EmailMailboxSettings[];
      try {
        const snap = await root
          .collection("emailMailboxes")
          .where("assignedUserIds", "array-contains", input.viewerUid)
          .get();
        // Assigned mailboxes are read-only for the viewer - skip secret vault reads.
        return snap.docs.map((doc) =>
          firestoreToMailbox(doc.id, doc.data() as Record<string, unknown>, null, {
            dataOwnerUid: u.id,
            stripSecrets: true,
          }),
        );
      } catch {
        // Older profiles without the indexable field - skip.
        return [] as EmailMailboxSettings[];
      }
    }),
  );
  const out = chunks.flat();
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

/** Look up which member in the organization owns mailboxId, and return the profile with secrets. */
export async function findMailboxHostInOrgServer(input: {
  organizationId: string;
  mailboxId: string;
}): Promise<{ uid: string; mailbox: EmailMailboxSettings } | null> {
  const db = getAdminDb();
  if (!db) {
    console.warn("[mailbox-profiles] findMailboxHostInOrgServer: Database not configured");
    return null;
  }

  console.log(`[mailbox-profiles] findMailboxHostInOrgServer: Searching for mailboxId: "${input.mailboxId}" in org: "${input.organizationId}"`);

  try {
    const snap = await db.collectionGroup("emailMailboxes").get();
    console.log(`[mailbox-profiles] findMailboxHostInOrgServer: collectionGroup("emailMailboxes") returned ${snap.docs.length} total mailboxes`);
    for (const doc of snap.docs) {
      const docData = doc.data() as Record<string, unknown>;
      const matchId = doc.id === input.mailboxId || docData.id === input.mailboxId;
      if (!matchId) continue;

      const parts = doc.ref.path.split("/").filter(Boolean);
      // Path format: organizations/{orgId}/members/{uid}/emailMailboxes/{mailboxId}
      const orgIdx = parts.indexOf(COLLECTIONS.organizations);
      const memIdx = parts.indexOf(ORG_SUBCOLLECTIONS.members);
      const docOrg = orgIdx >= 0 && parts[orgIdx + 1] ? parts[orgIdx + 1] : "";
      if (docOrg && docOrg !== input.organizationId) {
        console.log(`[mailbox-profiles] findMailboxHostInOrgServer: Matched mailboxId "${input.mailboxId}" but belongs to org "${docOrg}" (expected "${input.organizationId}"). Skipping for isolation.`);
        continue;
      }
      const hostUid = memIdx >= 0 && parts[memIdx + 1] ? parts[memIdx + 1] : "";
      if (!hostUid) {
        console.warn(`[mailbox-profiles] findMailboxHostInOrgServer: Matched mailbox "${input.mailboxId}" but could not extract hostUid from path: "${doc.ref.path}"`);
        continue;
      }

      console.log(`[mailbox-profiles] findMailboxHostInOrgServer: Found candidate mailbox owner hostUid: "${hostUid}" at path: "${doc.ref.path}"`);
      const profile = await getMailboxProfileServer({
        organizationId: input.organizationId,
        uid: hostUid,
        mailboxId: input.mailboxId,
      });
      if (profile) {
        console.log(`[mailbox-profiles] findMailboxHostInOrgServer: Successfully resolved mailbox profile for hostUid: "${hostUid}", email: "${profile.emailAddress}"`);
        return { uid: hostUid, mailbox: profile };
      } else {
        console.warn(`[mailbox-profiles] findMailboxHostInOrgServer: Found candidate doc at "${doc.ref.path}" but getMailboxProfileServer returned null for hostUid "${hostUid}"`);
      }
    }
  } catch (err) {
    console.warn(`[mailbox-profiles] findMailboxHostInOrgServer: collectionGroup search encountered an error, falling back to per-member search. Error:`, err);
  }

  try {
    console.log(`[mailbox-profiles] findMailboxHostInOrgServer: Scanning org users fallback for org: "${input.organizationId}"`);
    const users = await listOrgUsersServer(input.organizationId);
    console.log(`[mailbox-profiles] findMailboxHostInOrgServer: Found ${users.length} members in org "${input.organizationId}"`);
    for (const user of users) {
      if (!user.id) continue;
      const profile = await getMailboxProfileServer({
        organizationId: input.organizationId,
        uid: user.id,
        mailboxId: input.mailboxId,
      });
      if (profile) {
        console.log(`[mailbox-profiles] findMailboxHostInOrgServer: Fallback per-member search matched mailbox "${input.mailboxId}" under user "${user.id}" ("${profile.emailAddress}")`);
        return { uid: user.id, mailbox: profile };
      }
    }
  } catch (err) {
    console.warn(`[mailbox-profiles] findMailboxHostInOrgServer: Error during fallback per-member search:`, err);
  }

  console.warn(`[mailbox-profiles] findMailboxHostInOrgServer: Mailbox "${input.mailboxId}" was NOT found in org "${input.organizationId}"`);
  return null;
}

/** True when the host has at least one mailbox assigned to the viewer. */
export async function viewerHasAssignedMailboxOnHostServer(input: {
  organizationId: string;
  hostId: string;
  viewerUid: string;
}): Promise<boolean> {
  const root = memberRoot(input.organizationId, input.hostId);
  if (!root) return false;
  try {
    const snap = await root
      .collection("emailMailboxes")
      .where("assignedUserIds", "array-contains", input.viewerUid)
      .limit(1)
      .get();
    return !snap.empty;
  } catch {
    return false;
  }
}

export async function upsertMailboxProfileServer(input: {
  organizationId: string;
  uid: string;
  mailbox: EmailMailboxSettings;
}): Promise<{ ok: true } | { error: string }> {
  const ref = mailboxProfileRef(input.organizationId, input.uid, input.mailbox.id);
  if (!ref) return { error: "Database not configured" };
  await ref.set(profileToFirestore(input.mailbox), { merge: true });
  return { ok: true };
}

/** Merge incoming secrets with stored vault when password fields are left blank (unchanged). */
export async function upsertMailboxWithSecretsMerged(input: {
  organizationId: string;
  uid: string;
  mailbox: EmailMailboxSettings;
}): Promise<{ ok: true } | { error: string }> {
  let mailbox = input.mailbox;
  if (mailbox.connectionType === "google_workspace") {
    mailbox = withGoogleWorkspaceConnection(mailbox);
  } else if (mailbox.connectionType === "microsoft_outlook") {
    mailbox = withMicrosoftOutlookConnection(mailbox);
  }

  const existing = await getMailboxSecretsServer({
    organizationId: input.organizationId,
    uid: input.uid,
    mailboxId: mailbox.id,
  });

  let smtpUser = mailbox.smtp.user.trim();
  let smtpPassword = mailbox.smtp.password;
  let imapUser = mailbox.imap.user.trim();
  let imapPassword = mailbox.imap.password;

  if (mailbox.connectionType === "google_workspace") {
    const email = mailbox.emailAddress.trim();
    if (email) {
      smtpUser = email;
      imapUser = email;
    }
    if (smtpPassword && !imapPassword) imapPassword = smtpPassword;
  }

  if (existing) {
    if (!smtpUser) smtpUser = existing.smtp.user;
    if (!smtpPassword) smtpPassword = existing.smtp.password;
    if (!imapUser) imapUser = existing.imap.user;
    if (!imapPassword) imapPassword = existing.imap.password;
  }

  const profileResult = await upsertMailboxProfileServer({
    organizationId: input.organizationId,
    uid: input.uid,
    mailbox: {
      ...mailbox,
      signature: typeof mailbox.signature === "string" ? mailbox.signature : "",
      smtp: { ...mailbox.smtp, user: smtpUser, password: "" },
      imap: { ...mailbox.imap, user: imapUser, password: "" },
    },
  });
  if ("error" in profileResult) return profileResult;

  const secretsResult = await upsertMailboxSecretsServer({
    organizationId: input.organizationId,
    uid: input.uid,
    mailboxId: mailbox.id,
    secrets: {
      smtp: { user: smtpUser, password: smtpPassword },
      imap: { user: imapUser, password: imapPassword },
    },
  });
  if ("error" in secretsResult) return secretsResult;

  return { ok: true };
}

export async function deleteMailboxForMemberServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
}): Promise<{ ok: true } | { error: string }> {
  const ref = mailboxProfileRef(input.organizationId, input.uid, input.mailboxId);
  if (!ref) return { error: "Database not configured" };
  // Profile + nested sendStats / inboxSync (and any other subdocs under this mailbox).
  await deleteDocumentSubtree(ref.path);
  await deleteMailboxSecretsServer(input);
  return { ok: true };
}
