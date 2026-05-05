import crypto from "crypto";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";

type MailboxSecretsInput = {
  smtp: { user: string; password: string };
  imap: { user: string; password: string };
};

type MailboxSecretsStored = {
  smtp: { user: string; password: string };
  imap: { user: string; password: string };
};

type EncryptedBlob = {
  iv: string;
  tag: string;
  value: string;
};

function getSecretsKey(): Buffer | null {
  const raw = process.env.EMAIL_SECRETS_KEY_BASE64?.trim();
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) return null;
    return key;
  } catch {
    return null;
  }
}

function encryptValue(value: string, key: Buffer): EncryptedBlob {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    value: encrypted.toString("base64"),
  };
}

function decryptValue(payload: EncryptedBlob, key: Buffer): string {
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const value = Buffer.from(payload.value, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(value), decipher.final()]).toString("utf8");
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function mailboxSecretDoc(orgId: string, uid: string, mailboxId: string) {
  const db = getAdminDb();
  if (!db) return null;
  return db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.members)
    .doc(uid)
    .collection("emailMailboxSecrets")
    .doc(mailboxId);
}

export async function upsertMailboxSecretsServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  secrets: MailboxSecretsInput;
}): Promise<{ ok: true } | { error: string }> {
  const key = getSecretsKey();
  if (!key) {
    return { error: "EMAIL_SECRETS_KEY_BASE64 is missing or invalid (must decode to 32 bytes)." };
  }
  const ref = mailboxSecretDoc(input.organizationId, input.uid, input.mailboxId);
  if (!ref) return { error: "Database not configured" };

  await ref.set(
    {
      smtpUser: encryptValue(input.secrets.smtp.user, key),
      smtpPassword: encryptValue(input.secrets.smtp.password, key),
      imapUser: encryptValue(input.secrets.imap.user, key),
      imapPassword: encryptValue(input.secrets.imap.password, key),
      smtpUserHash: sha256(input.secrets.smtp.user),
      smtpPasswordHash: sha256(input.secrets.smtp.password),
      imapUserHash: sha256(input.secrets.imap.user),
      imapPasswordHash: sha256(input.secrets.imap.password),
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  return { ok: true };
}

export async function deleteMailboxSecretsServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
}): Promise<{ ok: true } | { error: string }> {
  const ref = mailboxSecretDoc(input.organizationId, input.uid, input.mailboxId);
  if (!ref) return { error: "Database not configured" };
  await ref.delete();
  return { ok: true };
}

export async function getMailboxSecretsServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
}): Promise<MailboxSecretsStored | null> {
  const key = getSecretsKey();
  if (!key) return null;
  const ref = mailboxSecretDoc(input.organizationId, input.uid, input.mailboxId);
  if (!ref) return null;
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown>;
  try {
    return {
      smtp: {
        user: decryptValue(data.smtpUser as EncryptedBlob, key),
        password: decryptValue(data.smtpPassword as EncryptedBlob, key),
      },
      imap: {
        user: decryptValue(data.imapUser as EncryptedBlob, key),
        password: decryptValue(data.imapPassword as EncryptedBlob, key),
      },
    };
  } catch {
    return null;
  }
}
