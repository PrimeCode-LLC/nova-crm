import "server-only";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/documents/collections";
import type { StrategyProposal } from "@/lib/prospecting-strategy/assistant";

export type ProposalStatus = "pending" | "applied" | "discarded";

export type StrategyAssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  userId: string;
  userName?: string;
  createdAt: string;
  questions?: string[];
  warnings?: string[];
  proposal?: StrategyProposal | null;
  proposalStatus?: ProposalStatus;
  /** First message of a new topic; older messages are not sent to the model. */
  topicStart?: boolean;
  /** Strategy created/updated when the proposal was applied. */
  appliedStrategyId?: string;
  resolvedBy?: string;
};

/** Oldest messages drop off past this so the doc stays small. */
export const MAX_THREAD_MESSAGES = 80;

/** "general" for the list page, otherwise the strategy id. */
export function isValidThreadKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{1,160}$/.test(key);
}

function threadDoc(organizationId: string, threadKey: string) {
  const db = getAdminDb();
  if (!db) return null;
  return db
    .collection(COLLECTIONS.organizations)
    .doc(organizationId)
    .collection(ORG_SUBCOLLECTIONS.strategyAssistantThreads)
    .doc(threadKey);
}

export async function loadStrategyAssistantThread(
  organizationId: string,
  threadKey: string,
): Promise<StrategyAssistantMessage[]> {
  const ref = threadDoc(organizationId, threadKey);
  if (!ref) return [];
  const snap = await ref.get();
  if (!snap.exists) return [];
  const messages = (snap.data() as { messages?: unknown }).messages;
  return Array.isArray(messages) ? (messages as StrategyAssistantMessage[]) : [];
}

export async function appendStrategyAssistantMessages(
  organizationId: string,
  threadKey: string,
  add: StrategyAssistantMessage[],
): Promise<void> {
  const ref = threadDoc(organizationId, threadKey);
  const db = getAdminDb();
  if (!ref || !db) throw new Error("Database not configured");
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists
      ? (((snap.data() as { messages?: StrategyAssistantMessage[] }).messages ?? []) as StrategyAssistantMessage[])
      : [];
    const messages = [...current, ...add].slice(-MAX_THREAD_MESSAGES);
    // JSON round-trip drops `undefined`, which the document store rejects.
    tx.set(
      ref,
      JSON.parse(
        JSON.stringify({ organizationId, threadKey, messages, updatedAt: new Date().toISOString() }),
      ),
    );
  });
}

export async function setStrategyAssistantProposalStatus(input: {
  organizationId: string;
  threadKey: string;
  messageId: string;
  status: Exclude<ProposalStatus, "pending">;
  appliedStrategyId?: string;
  resolvedBy: string;
}): Promise<boolean> {
  const ref = threadDoc(input.organizationId, input.threadKey);
  const db = getAdminDb();
  if (!ref || !db) throw new Error("Database not configured");
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const data = snap.data() as { messages?: StrategyAssistantMessage[] };
    const messages = data.messages ?? [];
    const target = messages.find((m) => m.id === input.messageId);
    if (!target?.proposal || target.proposalStatus !== "pending") return false;
    target.proposalStatus = input.status;
    target.resolvedBy = input.resolvedBy;
    if (input.appliedStrategyId) target.appliedStrategyId = input.appliedStrategyId;
    tx.set(ref, JSON.parse(JSON.stringify({ ...data, messages, updatedAt: new Date().toISOString() })));
    return true;
  });
}
