import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { WorkspaceChatChannel, WorkspaceChatMessage } from "@/lib/types";

function newId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

function sanitizeOrgKey(orgId: string) {
  return orgId.replace(/\//g, "_").replace(/\s+/g, "_").slice(0, 120);
}

export function generalChannelId(organizationId: string) {
  return `ch_${sanitizeOrgKey(organizationId)}_general`;
}

export function dmChannelId(uidA: string, uidB: string) {
  const [a, b] = [uidA, uidB].sort();
  return `dm_${a}__${b}`;
}

export type TeamChatDemoState = {
  channelsByOrg: Record<string, WorkspaceChatChannel[]>;
  messagesByOrg: Record<string, WorkspaceChatMessage[]>;
  /** org → userId → channelId → last read message time (ISO). */
  channelLastReadByOrgUser: Record<string, Record<string, Record<string, string>>>;
  bootstrapOrg: (organizationId: string, currentUserId: string) => void;
  upsertChannel: (organizationId: string, ch: WorkspaceChatChannel) => void;
  appendMessage: (organizationId: string, msg: WorkspaceChatMessage) => void;
  renameChannel: (organizationId: string, channelId: string, name: string) => void;
  setDemoChannelLastRead: (organizationId: string, userId: string, channelId: string, iso: string) => void;
};

export const useTeamChatDemoStore = create<TeamChatDemoState>()(
  persist(
    (set, get) => ({
      channelsByOrg: {},
      messagesByOrg: {},
      channelLastReadByOrgUser: {},
      setDemoChannelLastRead(organizationId, userId, channelId, iso) {
        const orgMap = { ...(get().channelLastReadByOrgUser[organizationId] ?? {}) };
        const userMap = { ...(orgMap[userId] ?? {}) };
        userMap[channelId] = iso;
        orgMap[userId] = userMap;
        set({
          channelLastReadByOrgUser: {
            ...get().channelLastReadByOrgUser,
            [organizationId]: orgMap,
          },
        });
      },
      bootstrapOrg(organizationId, currentUserId) {
        const gid = generalChannelId(organizationId);
        const iso = new Date().toISOString();
        const existing = get().channelsByOrg[organizationId] ?? [];
        if (existing.some((c) => c.id === gid)) return;
        const general: WorkspaceChatChannel = {
          id: gid,
          organizationId,
          kind: "public",
          slug: "general",
          name: "general",
          createdById: currentUserId,
          createdAt: iso,
        };
        const welcome: WorkspaceChatMessage = {
          id: newId("msg"),
          organizationId,
          channelId: gid,
          authorId: currentUserId,
          body: "Welcome to Team chat. This is #general. Use @ from the message box to mention someone, or start a direct message from the teammate list.",
          createdAt: iso,
        };
        set({
          channelsByOrg: {
            ...get().channelsByOrg,
            [organizationId]: [general, ...existing],
          },
          messagesByOrg: {
            ...get().messagesByOrg,
            [organizationId]: [...(get().messagesByOrg[organizationId] ?? []), welcome],
          },
        });
      },
      upsertChannel(organizationId, ch) {
        const list = [...(get().channelsByOrg[organizationId] ?? [])];
        const i = list.findIndex((c) => c.id === ch.id);
        if (i >= 0) list[i] = ch;
        else list.push(ch);
        set({
          channelsByOrg: { ...get().channelsByOrg, [organizationId]: list },
        });
      },
      appendMessage(organizationId, msg) {
        const list = [...(get().messagesByOrg[organizationId] ?? []), msg];
        set({
          messagesByOrg: { ...get().messagesByOrg, [organizationId]: list },
        });
      },
      renameChannel(organizationId, channelId, name) {
        const list = (get().channelsByOrg[organizationId] ?? []).map((c) =>
          c.id === channelId ? { ...c, name } : c,
        );
        set({
          channelsByOrg: { ...get().channelsByOrg, [organizationId]: list },
        });
      },
    }),
    {
      name: "sales-crm-team-chat-demo",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        channelsByOrg: s.channelsByOrg,
        messagesByOrg: s.messagesByOrg,
        channelLastReadByOrgUser: s.channelLastReadByOrgUser,
      }),
    },
  ),
);
