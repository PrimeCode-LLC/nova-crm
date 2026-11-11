import { beforeEach, describe, expect, it, vi } from "vitest";

const docs = new Map<string, Record<string, unknown>>();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/document-access/admin", () => {
  const ref = (path: string) => ({
    path,
    get: async () => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) }),
  });
  const node = (path: string): unknown => ({
    collection: (name: string) => ({ doc: (id: string) => ({ ...ref(`${path}/${name}/${id}`), collection: node(`${path}/${name}/${id}`) as never }) }),
  });
  return {
    getAdminDb: () => ({
      collection: (name: string) => ({
        doc: (id: string) => node(`${name}/${id}`),
      }),
      runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          get: (r: { get: () => Promise<unknown> }) => r.get(),
          set: (r: { path: string }, data: Record<string, unknown>) => docs.set(r.path, structuredClone(data)),
        }),
    }),
  };
});

import {
  appendStrategyAssistantMessages,
  isValidThreadKey,
  listStrategyAssistantChats,
  loadStrategyAssistantThread,
  type StrategyAssistantMessage,
} from "./assistant-threads-server";

const ORG = "org-1";
const base = `organizations/${ORG}/strategyAssistantThreads`;

function msg(content: string, createdAt: string): StrategyAssistantMessage {
  return { id: content, role: "user", content, userId: "u-1", createdAt };
}

describe("strategy assistant chats", () => {
  beforeEach(() => docs.clear());

  it("accepts a page's first chat and its later chats, nothing else", () => {
    expect(isValidThreadKey("general")).toBe(true);
    expect(isValidThreadKey("ps-9be9b5af-564a")).toBe(true);
    expect(isValidThreadKey("general__c-a1b2c3d4")).toBe(true);
    expect(isValidThreadKey("general__index")).toBe(false);
    expect(isValidThreadKey("general__c-a1b2c3d4__c-x9y8z7w6")).toBe(false);
    expect(isValidThreadKey("../general")).toBe(false);
  });

  it("lists a page's chats newest first and keeps each chat's messages separate", async () => {
    await appendStrategyAssistantMessages(ORG, "general", [msg("Create a logistics strategy", "2026-11-12T10:00:00Z")]);
    await new Promise((r) => setTimeout(r, 5));
    await appendStrategyAssistantMessages(ORG, "general__c-abc123def", [msg("Healthcare idea", "2026-11-12T11:00:00Z")]);
    await appendStrategyAssistantMessages(ORG, "ps-1", [msg("Fill this one", "2026-11-12T12:00:00Z")]);

    const chats = await listStrategyAssistantChats(ORG, "general");
    expect(chats.map((c) => [c.threadKey, c.title, c.messageCount])).toEqual([
      ["general__c-abc123def", "Healthcare idea", 1],
      ["general", "Create a logistics strategy", 1],
    ]);
    expect((await loadStrategyAssistantThread(ORG, "general")).map((m) => m.content)).toEqual([
      "Create a logistics strategy",
    ]);
    expect((await listStrategyAssistantChats(ORG, "ps-1")).map((c) => c.threadKey)).toEqual(["ps-1"]);
  });

  it("still lists a chat saved before the chat list existed", async () => {
    docs.set(`${base}/general`, { messages: [msg("Old chat", "2026-11-11T09:00:00Z")] });
    const chats = await listStrategyAssistantChats(ORG, "general");
    expect(chats).toEqual([
      { threadKey: "general", title: "Old chat", updatedAt: "2026-11-11T09:00:00Z", messageCount: 1 },
    ]);
  });
});
