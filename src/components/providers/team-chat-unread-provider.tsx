"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { collection, doc, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { toast } from "sonner";
import { getFirebaseDb } from "@/lib/firebase/client";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { firestoreValueToIso } from "@/lib/firestore/timestamp-util";
import { persistWorkspaceChatChannelLastRead } from "@/lib/firestore/persist-workspace-entities-client";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { DEMO_WORKSPACE_ORG_ID } from "@/lib/demo-workspace-ids";
import { useTeamChatDemoStore } from "@/stores/team-chat-demo-store";
import type { User, WorkspaceChatChannel, WorkspaceChatMessage } from "@/lib/types";

const RECENT_MSG_LIMIT = 250;

function asChannelRaw(id: string, raw: Record<string, unknown>): WorkspaceChatChannel {
  return {
    id,
    organizationId: String(raw.organizationId ?? ""),
    kind: (raw.kind as WorkspaceChatChannel["kind"]) ?? "public",
    slug: String(raw.slug ?? "channel"),
    name: String(raw.name ?? raw.slug ?? id),
    memberIds: Array.isArray(raw.memberIds) ? (raw.memberIds as string[]) : undefined,
    createdById: String(raw.createdById ?? ""),
    createdAt: firestoreValueToIso(raw.createdAt),
    updatedAt: raw.updatedAt ? firestoreValueToIso(raw.updatedAt) : undefined,
  };
}

function asMessageRaw(id: string, raw: Record<string, unknown>): WorkspaceChatMessage {
  const mentionUserIds = Array.isArray(raw.mentionUserIds) ? (raw.mentionUserIds as string[]) : undefined;
  return {
    id,
    organizationId: String(raw.organizationId ?? ""),
    channelId: String(raw.channelId ?? ""),
    authorId: String(raw.authorId ?? ""),
    body: String(raw.body ?? ""),
    mentionUserIds,
    createdAt: firestoreValueToIso(raw.createdAt),
  };
}

function channelAccessible(ch: WorkspaceChatChannel, uid: string): boolean {
  if (ch.kind === "public") return true;
  return Boolean(ch.memberIds?.includes(uid));
}

function maxIso(a: string, b: string): string {
  return a >= b ? a : b;
}

function buildCatchupBaseline(
  channels: WorkspaceChatChannel[],
  messages: WorkspaceChatMessage[],
): Record<string, string> {
  const now = new Date().toISOString();
  const out: Record<string, string> = {};
  for (const ch of channels) {
    let max = "";
    for (const m of messages) {
      if (m.channelId !== ch.id) continue;
      max = max ? maxIso(max, m.createdAt) : m.createdAt;
    }
    out[ch.id] = max || now;
  }
  return out;
}

function computeUnread(
  channels: WorkspaceChatChannel[],
  messages: WorkspaceChatMessage[],
  uid: string,
  channelReads: Record<string, string>,
  catchupBaseline: Record<string, string>,
): { byChannel: Record<string, number>; total: number } {
  const byChannel: Record<string, number> = {};
  let total = 0;
  for (const ch of channels) {
    if (!channelAccessible(ch, uid)) continue;
    const lr = channelReads[ch.id] ?? catchupBaseline[ch.id] ?? new Date().toISOString();
    let c = 0;
    for (const m of messages) {
      if (m.channelId !== ch.id) continue;
      if (m.authorId === uid) continue;
      if (m.createdAt > lr) c++;
    }
    if (c > 0) {
      byChannel[ch.id] = c;
      total += c;
    }
  }
  return { byChannel, total };
}

function chatLabel(ch: WorkspaceChatChannel, selfId: string, users: User[]): string {
  if (ch.kind !== "dm" || !ch.memberIds?.length) {
    const n = ch.name?.trim() || ch.slug || "channel";
    return n.startsWith("#") ? n : `#${n}`;
  }
  const other = ch.memberIds.find((id) => id !== selfId);
  const u = users.find((x) => x.id === other);
  return u?.displayName?.trim() ? u.displayName : "Direct message";
}

export type TeamChatUnreadContextValue = {
  teamChatUnreadByChannel: Record<string, number>;
  teamChatUnreadTotal: number;
  markTeamChatChannelRead: (channelId: string, readThroughIso: string) => void;
  /** Team chat panel should register the channel currently open so alerts still fire for other threads. */
  registerTeamChatSelection: (channelId: string | null) => void;
};

const TeamChatUnreadContext = React.createContext<TeamChatUnreadContextValue | null>(null);

export function useTeamChatUnread(): TeamChatUnreadContextValue {
  const ctx = React.useContext(TeamChatUnreadContext);
  if (!ctx) {
    throw new Error("useTeamChatUnread must be used within TeamChatUnreadProvider");
  }
  return ctx;
}

export function TeamChatUnreadProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { organizationId, currentUserId, isDemo, users } = useWorkspace();
  const setDemoChannelLastRead = useTeamChatDemoStore((s) => s.setDemoChannelLastRead);
  const demoChannels = useTeamChatDemoStore((s) => s.channelsByOrg[DEMO_WORKSPACE_ORG_ID] ?? []);
  const demoMessages = useTeamChatDemoStore((s) => s.messagesByOrg[DEMO_WORKSPACE_ORG_ID] ?? []);
  const demoLastReadRoot = useTeamChatDemoStore((s) => s.channelLastReadByOrgUser);
  const demoReads = React.useMemo(
    () => demoLastReadRoot[DEMO_WORKSPACE_ORG_ID]?.[currentUserId] ?? {},
    [demoLastReadRoot, currentUserId],
  );

  const [liveChannels, setLiveChannels] = React.useState<WorkspaceChatChannel[]>([]);
  const [liveRecentMessages, setLiveRecentMessages] = React.useState<WorkspaceChatMessage[]>([]);
  const [liveChannelReads, setLiveChannelReads] = React.useState<Record<string, string>>({});

  const liveEnabled =
    !isDemo && Boolean(organizationId && currentUserId && isFirebaseWebConfigured());

  React.useEffect(() => {
    if (!liveEnabled || !organizationId) {
      setLiveChannels([]);
      setLiveRecentMessages([]);
      setLiveChannelReads({});
      return;
    }
    let db: ReturnType<typeof getFirebaseDb>;
    try {
      db = getFirebaseDb();
    } catch {
      setLiveChannels([]);
      setLiveRecentMessages([]);
      setLiveChannelReads({});
      return;
    }

    const qCh = query(
      collection(db, COLLECTIONS.workspaceChatChannels),
      where("organizationId", "==", organizationId),
    );
    const unsubCh = onSnapshot(qCh, (snap) => {
      const list = snap.docs.map((d) => asChannelRaw(d.id, d.data() as Record<string, unknown>));
      list.sort((a, b) => a.name.localeCompare(b.name));
      setLiveChannels(list);
    });

    const qMsg = query(
      collection(db, COLLECTIONS.workspaceChatMessages),
      where("organizationId", "==", organizationId),
      orderBy("createdAt", "desc"),
      limit(RECENT_MSG_LIMIT),
    );
    const unsubMsg = onSnapshot(qMsg, (snap) => {
      const list = snap.docs.map((d) => asMessageRaw(d.id, d.data() as Record<string, unknown>));
      setLiveRecentMessages(list);
    });

    const readRef = doc(db, COLLECTIONS.workspaceChatReads, `${organizationId}__${currentUserId}`);
    const unsubRead = onSnapshot(readRef, (snap) => {
      if (!snap.exists()) {
        setLiveChannelReads({});
        return;
      }
      const raw = snap.data() as Record<string, unknown>;
      const ch = raw.channels;
      if (ch && typeof ch === "object" && !Array.isArray(ch)) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(ch as Record<string, unknown>)) {
          if (typeof v === "string") out[k] = v;
        }
        setLiveChannelReads(out);
      } else {
        setLiveChannelReads({});
      }
    });

    return () => {
      unsubCh();
      unsubMsg();
      unsubRead();
    };
  }, [liveEnabled, organizationId, currentUserId]);

  const channels = isDemo ? demoChannels : liveChannels;
  const recentMessages = isDemo ? demoMessages : liveRecentMessages;
  const channelReads = isDemo ? demoReads : liveChannelReads;

  const catchupBaseline = React.useMemo(
    () => buildCatchupBaseline(channels, recentMessages),
    [channels, recentMessages],
  );

  const { byChannel: teamChatUnreadByChannel, total: teamChatUnreadTotal } = React.useMemo(
    () => computeUnread(channels, recentMessages, currentUserId, channelReads, catchupBaseline),
    [channels, recentMessages, currentUserId, channelReads, catchupBaseline],
  );

  const markTeamChatChannelRead = React.useCallback(
    (channelId: string, readThroughIso: string) => {
      if (!channelId || !readThroughIso) return;
      if (isDemo) {
        setDemoChannelLastRead(DEMO_WORKSPACE_ORG_ID, currentUserId, channelId, readThroughIso);
        return;
      }
      if (!organizationId || !currentUserId || !isFirebaseWebConfigured()) return;
      try {
        const db = getFirebaseDb();
        void persistWorkspaceChatChannelLastRead(db, organizationId, currentUserId, channelId, readThroughIso);
      } catch {
        /* ignore */
      }
    },
    [isDemo, organizationId, currentUserId, setDemoChannelLastRead],
  );

  const seenNotifyIdsRef = React.useRef<Set<string>>(new Set());
  const notifyBootstrappedRef = React.useRef(false);
  const teamChatSelectionRef = React.useRef<string | null>(null);
  const registerTeamChatSelection = React.useCallback((channelId: string | null) => {
    teamChatSelectionRef.current = channelId;
  }, []);
  const channelsRef = React.useRef(channels);
  channelsRef.current = channels;
  const channelReadsRef = React.useRef(channelReads);
  channelReadsRef.current = channelReads;
  const catchupBaselineRef = React.useRef(catchupBaseline);
  catchupBaselineRef.current = catchupBaseline;

  React.useEffect(() => {
    seenNotifyIdsRef.current.clear();
    notifyBootstrappedRef.current = false;
    teamChatSelectionRef.current = null;
  }, [organizationId, isDemo, currentUserId]);

  React.useEffect(() => {
    if (!currentUserId) return;

    if (recentMessages.length === 0) {
      if (channels.length > 0) notifyBootstrappedRef.current = true;
      return;
    }

    const onTeamChat = pathname === "/team-chat";
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    const isBootstrapPass = !notifyBootstrappedRef.current;

    for (const m of recentMessages) {
      if (seenNotifyIdsRef.current.has(m.id)) continue;
      seenNotifyIdsRef.current.add(m.id);
      if (isBootstrapPass) continue;
      if (m.authorId === currentUserId) continue;

      const lr =
        channelReadsRef.current[m.channelId] ??
        catchupBaselineRef.current[m.channelId] ??
        new Date().toISOString();
      if (m.createdAt <= lr) continue;

      const viewingThisThread =
        onTeamChat && !hidden && teamChatSelectionRef.current === m.channelId;
      if (viewingThisThread) continue;

      const ch = channelsRef.current.find((c) => c.id === m.channelId);
      if (!ch || !channelAccessible(ch, currentUserId)) continue;

      const author = users.find((u) => u.id === m.authorId);
      const label = chatLabel(ch, currentUserId, users);
      const preview = m.body.trim().slice(0, 120) || "New message";
      const title = `${author?.displayName ?? "Teammate"} · ${label}`;

      toast.message(title, {
        description: preview,
        duration: 6000,
        action: {
          label: "Open",
          onClick: () => {
            router.push("/team-chat");
          },
        },
      });

      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          new Notification(title, { body: preview, tag: m.id });
        } catch {
          /* ignore */
        }
      }
    }

    notifyBootstrappedRef.current = true;
  }, [recentMessages, channels, currentUserId, pathname, users, router]);

  const value = React.useMemo(
    () => ({
      teamChatUnreadByChannel,
      teamChatUnreadTotal,
      markTeamChatChannelRead,
      registerTeamChatSelection,
    }),
    [teamChatUnreadByChannel, teamChatUnreadTotal, markTeamChatChannelRead, registerTeamChatSelection],
  );

  return <TeamChatUnreadContext.Provider value={value}>{children}</TeamChatUnreadContext.Provider>;
}
