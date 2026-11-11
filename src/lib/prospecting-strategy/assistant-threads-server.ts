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
  /** Strategy created/updated when the proposal was applied. */
  appliedStrategyId?: string;
  resolvedBy?: string;
};

/** Oldest messages drop off past this so the doc stays small. */
export const MAX_THREAD_MESSAGES = 80;

/**
 * A chat is stored under its thread key. Each page has a scope ("general" for
 * the list page, otherwise the strategy id). The first chat of a scope uses the
 * scope itself as its key (chats saved before multi-chat keep working); later
 * chats are `{scope}__c-{id}`. `{scope}__index` lists a scope's chats.
 */
const CHAT_SEPARATOR = "__c-";
const INDEX_SUFFIX = "__index";

export function isValidScope(scope: string): boolean {
  return /^[A-Za-z0-9_-]{1,120}$/.test(scope) && !scope.includes("__");
}

export function isValidThreadKey(key: string): boolean {
  const [scope, chat, ...rest] = key.split(CHAT_SEPARATOR);
  if (rest.length || !scope || !isValidScope(scope)) return false;
  return chat === undefined || /^[a-z0-9]{6,40}$/.test(chat);
}

export function scopeOfThread(key: string): string {
  return key.split(CHAT_SEPARATOR)[0]!;
}

export type StrategyAssistantChatSummary = {
  threadKey: string;
  title: string;
  updatedAt: string;
  messageCount: number;
};

function chatTitle(messages: StrategyAssistantMessage[]): string {
  const first = messages.find((m) => m.role === "user")?.content.trim() ?? "New chat";
  return first.length > 70 ? `${first.slice(0, 69)}…` : first;
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

/** Chats for a scope, newest first. */
export async function listStrategyAssistantChats(
  organizationId: string,
  scope: string,
): Promise<StrategyAssistantChatSummary[]> {
  const indexRef = threadDoc(organizationId, `${scope}${INDEX_SUFFIX}`);
  if (!indexRef) return [];
  const snap = await indexRef.get();
  const chats = snap.exists
    ? (((snap.data() as { chats?: StrategyAssistantChatSummary[] }).chats ?? []) as StrategyAssistantChatSummary[])
    : [];
  if (!chats.some((c) => c.threadKey === scope)) {
    // Chat saved before the index existed.
    const legacy = await loadStrategyAssistantThread(organizationId, scope);
    if (legacy.length) {
      chats.push({
        threadKey: scope,
        title: chatTitle(legacy),
        updatedAt: legacy.at(-1)!.createdAt,
        messageCount: legacy.length,
      });
    }
  }
  return chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
  const indexRef = threadDoc(organizationId, `${scopeOfThread(threadKey)}${INDEX_SUFFIX}`);
  const db = getAdminDb();
  if (!ref || !indexRef || !db) throw new Error("Database not configured");
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const indexSnap = await tx.get(indexRef);
    const current = snap.exists
      ? (((snap.data() as { messages?: StrategyAssistantMessage[] }).messages ?? []) as StrategyAssistantMessage[])
      : [];
    const messages = [...current, ...add].slice(-MAX_THREAD_MESSAGES);
    const chats = indexSnap.exists
      ? (((indexSnap.data() as { chats?: StrategyAssistantChatSummary[] }).chats ?? []) as StrategyAssistantChatSummary[])
      : [];
    const summary: StrategyAssistantChatSummary = {
      threadKey,
      title: chatTitle(messages),
      updatedAt: new Date().toISOString(),
      messageCount: messages.length,
    };
    tx.set(indexRef, {
      organizationId,
      chats: [summary, ...chats.filter((c) => c.threadKey !== threadKey)],
      updatedAt: summary.updatedAt,
    });
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
