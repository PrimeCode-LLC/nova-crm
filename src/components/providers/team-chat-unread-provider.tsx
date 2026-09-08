"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { toast } from "sonner";
import { playAlertSound } from "@/lib/notifications/play-alert-sound";
import { getFirebaseDb } from "@/lib/firebase/client";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { subscribeWorkspaceChatChannelsForUser } from "@/lib/firestore/workspace-chat-channel-subscribe";
import { firestoreValueToIso } from "@/lib/firestore/timestamp-util";
import { persistWorkspaceChatChannelLastRead } from "@/lib/firestore/persist-workspace-entities-client";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { DEMO_WORKSPACE_ORG_ID } from "@/lib/demo-workspace-ids";
import { useTeamChatDemoStore } from "@/stores/team-chat-demo-store";
import type { User, WorkspaceChatChannel, WorkspaceChatMessage } from "@/lib/types";

const RECENT_MSG_LIMIT = 250;
const CHANNEL_ID_IN_QUERY_LIMIT = 10;

/** Stable fallbacks for Zustand selectors - `?? []` allocates a new array each snapshot, which makes `useSyncExternalStore` think the value changed every render and triggers React #185 (max update depth) in production builds. */
const EMPTY_DEMO_CHANNELS: WorkspaceChatChannel[] = [];
const EMPTY_DEMO_MESSAGES: WorkspaceChatMessage[] = [];
const EMPTY_DEMO_LAST_READ_ROOT: Record<string, Record<string, Record<string, string>>> = {};
const EMPTY_DEMO_READS: Record<string, string> = {};

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

export function TeamChatUnreadProvider({
  children,
  deferSubscriptions = false,
}: {
  children: React.ReactNode;
  /** Delay Firestore listeners until after first paint (sidebar badge hydrates shortly after). */
  deferSubscriptions?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { organizationId, currentUserId, isDemo, users, backupOnlyMode } = useWorkspace();
  const [subscriptionsReady, setSubscriptionsReady] = React.useState(!deferSubscriptions);

  React.useEffect(() => {
    if (backupOnlyMode) {
      setSubscriptionsReady(false);
      return;
    }
    if (!deferSubscriptions || subscriptionsReady) return;
    const activate = () => setSubscriptionsReady(true);
    if (typeof requestIdleCallback !== "undefined") {
      const id = requestIdleCallback(activate, { timeout: 3000 });
      return () => cancelIdleCallback(id);
    }
    const timer = window.setTimeout(activate, 200);
    return () => window.clearTimeout(timer);
  }, [deferSubscriptions, subscriptionsReady, backupOnlyMode]);
  const setDemoChannelLastRead = useTeamChatDemoStore((s) => s.setDemoChannelLastRead);
  const demoChannels = useTeamChatDemoStore(
    (s) => s.channelsByOrg[DEMO_WORKSPACE_ORG_ID] ?? EMPTY_DEMO_CHANNELS,
  );
  const demoMessages = useTeamChatDemoStore(
    (s) => s.messagesByOrg[DEMO_WORKSPACE_ORG_ID] ?? EMPTY_DEMO_MESSAGES,
  );
  const demoLastReadRoot = useTeamChatDemoStore(
    (s) => s.channelLastReadByOrgUser ?? EMPTY_DEMO_LAST_READ_ROOT,
  );
  const demoReads = React.useMemo(
    () => demoLastReadRoot[DEMO_WORKSPACE_ORG_ID]?.[currentUserId] ?? EMPTY_DEMO_READS,
    [demoLastReadRoot, currentUserId],
  );

  const [liveChannels, setLiveChannels] = React.useState<WorkspaceChatChannel[]>([]);
  const [liveRecentMessages, setLiveRecentMessages] = React.useState<WorkspaceChatMessage[]>([]);
  const [liveChannelReads, setLiveChannelReads] = React.useState<Record<string, string>>({});

  const liveEnabled =
    subscriptionsReady &&
    !backupOnlyMode &&
    !isDemo &&
    Boolean(organizationId && currentUserId && isFirebaseWebConfigured());

  React.useEffect(() => {
    if (!liveEnabled || !organizationId || !currentUserId) {
      setLiveChannels([]);
      setLiveChannelReads({});
      return;
    }
    let db: ReturnType<typeof getFirebaseDb>;
    try {
      db = getFirebaseDb();
    } catch {
      setLiveChannels([]);
      setLiveChannelReads({});
      return;
    }

    const unsubCh = subscribeWorkspaceChatChannelsForUser(
      db,
      organizationId,
      currentUserId,
      asChannelRaw,
      (list) => setLiveChannels(list),
      () => setLiveChannels([]),
    );

    const readRef = doc(db, COLLECTIONS.workspaceChatReads, `${organizationId}__${currentUserId}`);
    const unsubRead = onSnapshot(
      readRef,
      (snap) => {
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
      },
      () => setLiveChannelReads({}),
    );

    return () => {
      unsubCh();
      unsubRead();
    };
  }, [liveEnabled, organizationId, currentUserId]);

  /** Recent messages only from channels the user can read (org-wide query fails security rules when DMs exist). */
  React.useEffect(() => {
    if (!liveEnabled || !organizationId || !currentUserId) {
      setLiveRecentMessages([]);
      return;
    }

    const accessibleIds = liveChannels
      .filter((ch) => channelAccessible(ch, currentUserId))
      .map((ch) => ch.id);
    if (!accessibleIds.length) {
      setLiveRecentMessages([]);
      return;
    }

    let db: ReturnType<typeof getFirebaseDb>;
    try {
      db = getFirebaseDb();
    } catch {
      setLiveRecentMessages([]);
      return;
    }

    const batches: string[][] = [];
    for (let i = 0; i < accessibleIds.length; i += CHANNEL_ID_IN_QUERY_LIMIT) {
      batches.push(accessibleIds.slice(i, i + CHANNEL_ID_IN_QUERY_LIMIT));
    }

    const byBatch = new Map<number, WorkspaceChatMessage[]>();
    const unsubs: Unsubscribe[] = [];

    const publishMerged = () => {
      const list = Array.from(byBatch.values())
        .flat()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setLiveRecentMessages(list.slice(0, RECENT_MSG_LIMIT));
    };

    batches.forEach((channelIds, batchIndex) => {
      const qMsg = query(
        collection(db, COLLECTIONS.workspaceChatMessages),
        where("organizationId", "==", organizationId),
        where("channelId", "in", channelIds),
        orderBy("createdAt", "desc"),
        limit(RECENT_MSG_LIMIT),
      );
      unsubs.push(
        onSnapshot(
          qMsg,
          (snap) => {
            byBatch.set(
              batchIndex,
              snap.docs.map((d) => asMessageRaw(d.id, d.data() as Record<string, unknown>)),
            );
            publishMerged();
          },
          () => {
            byBatch.delete(batchIndex);
            publishMerged();
          },
        ),
      );
    });

    return () => {
      for (const u of unsubs) u();
      byBatch.clear();
    };
  }, [liveEnabled, organizationId, currentUserId, liveChannels]);

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
  const usersRef = React.useRef(users);
  usersRef.current = users;

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

      const author = usersRef.current.find((u) => u.id === m.authorId);
      const label = chatLabel(ch, currentUserId, usersRef.current);
      const preview = m.body.trim().slice(0, 120) || "New message";
      const title = `${author?.displayName ?? "Teammate"} · ${label}`;

      playAlertSound("chat");

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
  }, [recentMessages, channels, currentUserId, pathname, router]);

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
