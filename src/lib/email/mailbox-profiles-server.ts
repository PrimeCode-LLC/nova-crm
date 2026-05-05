import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";
import type { EmailMailboxSettings } from "@/lib/email-account-types";
import {
  deleteMailboxSecretsServer,
  getMailboxSecretsServer,
  upsertMailboxSecretsServer,
} from "@/lib/email/mailbox-secrets-server";

const META_COLLECTION = "emailAccountState";
const META_DOC_ID = "default";

export type EmailAccountMeta = {
  activeMailboxId: string;
  linkedLeadByMessageId: Record<string, string>;
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
    updatedAt: new Date().toISOString(),
  };
}

function firestoreToMailbox(
  mailboxId: string,
  data: Record<string, unknown>,
  secrets: { smtp: { user: string; password: string }; imap: { user: string; password: string } } | null,
): EmailMailboxSettings {
  const smtpUser = secrets?.smtp.user ?? "";
  const smtpPassword = secrets?.smtp.password ?? "";
  const imapUser = secrets?.imap.user ?? "";
  const imapPassword = secrets?.imap.password ?? "";
  return {
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
  };
}

export async function getEmailAccountMetaServer(input: {
  organizationId: string;
  uid: string;
}): Promise<EmailAccountMeta> {
  const ref = metaRef(input.organizationId, input.uid);
  if (!ref) {
    return { activeMailboxId: "", linkedLeadByMessageId: {} };
  }
  const snap = await ref.get();
  if (!snap.exists) {
    return { activeMailboxId: "", linkedLeadByMessageId: {} };
  }
  const data = snap.data() as Record<string, unknown>;
  const active = String(data.activeMailboxId ?? "").trim();
  const links = data.linkedLeadByMessageId;
  const linkedLeadByMessageId =
    links && typeof links === "object" && !Array.isArray(links)
      ? (links as Record<string, string>)
      : {};
  return { activeMailboxId: active, linkedLeadByMessageId };
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
  await ref.set(patch, { merge: true });
  return { ok: true };
}

export async function listMailboxesForMemberServer(input: {
  organizationId: string;
  uid: string;
}): Promise<EmailMailboxSettings[]> {
  const root = memberRoot(input.organizationId, input.uid);
  if (!root) return [];
  const snap = await root.collection("emailMailboxes").get();
  const out: EmailMailboxSettings[] = [];
  for (const doc of snap.docs) {
    const secrets = await getMailboxSecretsServer({
      organizationId: input.organizationId,
      uid: input.uid,
      mailboxId: doc.id,
    });
    out.push(firestoreToMailbox(doc.id, doc.data(), secrets));
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
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
  const existing = await getMailboxSecretsServer({
    organizationId: input.organizationId,
    uid: input.uid,
    mailboxId: input.mailbox.id,
  });

  let smtpUser = input.mailbox.smtp.user.trim();
  let smtpPassword = input.mailbox.smtp.password;
  let imapUser = input.mailbox.imap.user.trim();
  let imapPassword = input.mailbox.imap.password;

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
      ...input.mailbox,
      smtp: { ...input.mailbox.smtp, user: smtpUser, password: "" },
      imap: { ...input.mailbox.imap, user: imapUser, password: "" },
    },
  });
  if ("error" in profileResult) return profileResult;

  const secretsResult = await upsertMailboxSecretsServer({
    organizationId: input.organizationId,
    uid: input.uid,
    mailboxId: input.mailbox.id,
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
  await ref.delete();
  await deleteMailboxSecretsServer(input);
  return { ok: true };
}
