"use client";

import * as React from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { firestoreValueToIso } from "@/lib/firestore/timestamp-util";
import {
  persistWorkspaceChatChannelCreate,
  persistWorkspaceChatMessageCreate,
} from "@/lib/firestore/persist-workspace-entities-client";
import type { WorkspaceChatChannel, WorkspaceChatMessage } from "@/lib/types";
import { dmChannelId, generalChannelId as buildGeneralChannelId, useTeamChatDemoStore } from "@/stores/team-chat-demo-store";

const DEMO_CHAT_ORG = "demo-org";

function asChannel(id: string, raw: Record<string, unknown>): WorkspaceChatChannel {
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

function asMessage(id: string, raw: Record<string, unknown>): WorkspaceChatMessage {
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

export type UseWorkspaceTeamChatOptions = {
  /** Live Firebase org id, or omitted in demo. */
  organizationId: string | undefined;
  isDemo: boolean;
  currentUserId: string;
};

export function useWorkspaceTeamChat({ organizationId, isDemo, currentUserId }: UseWorkspaceTeamChatOptions) {
  const [selectedChannelId, setSelectedChannelId] = React.useState<string | null>(null);
  const [liveChannels, setLiveChannels] = React.useState<WorkspaceChatChannel[]>([]);
  const [liveMessages, setLiveMessages] = React.useState<WorkspaceChatMessage[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);

  const demoChannels = useTeamChatDemoStore((s) => s.channelsByOrg[DEMO_CHAT_ORG] ?? []);
  const demoMessages = useTeamChatDemoStore((s) => s.messagesByOrg[DEMO_CHAT_ORG] ?? []);
  const demoBootstrap = useTeamChatDemoStore((s) => s.bootstrapOrg);
  const demoUpsertChannel = useTeamChatDemoStore((s) => s.upsertChannel);
  const demoAppendMessage = useTeamChatDemoStore((s) => s.appendMessage);

  const orgKey = isDemo ? DEMO_CHAT_ORG : organizationId ?? "";
  const effectiveOrgId = organizationId ?? (isDemo ? DEMO_CHAT_ORG : "");

  React.useEffect(() => {
    if (!isDemo || !currentUserId) return;
    demoBootstrap(DEMO_CHAT_ORG, currentUserId);
  }, [isDemo, currentUserId, demoBootstrap]);

  /** Live: subscribe all channels for org. */
  React.useEffect(() => {
    if (isDemo || !organizationId || !isFirebaseWebConfigured()) {
      setLiveChannels([]);
      setLoading(false);
      setError(null);
      return;
    }

    let db: ReturnType<typeof getFirebaseDb>;
    try {
      db = getFirebaseDb();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setLiveChannels([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const qCh = query(
      collection(db, COLLECTIONS.workspaceChatChannels),
      where("organizationId", "==", organizationId),
    );
    const unsub = onSnapshot(
      qCh,
      (snap) => {
        const channels = snap.docs.map((d) => asChannel(d.id, d.data() as Record<string, unknown>));
        channels.sort((a, b) => a.name.localeCompare(b.name));
        setLiveChannels(channels);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [isDemo, organizationId]);

  /** Ensure #general exists (live). */
  React.useEffect(() => {
    if (isDemo || !organizationId || !currentUserId || !isFirebaseWebConfigured()) return;
    if (loading) return;
    const gid = buildGeneralChannelId(organizationId);
    if (liveChannels.some((c) => c.slug === "general" || c.id === gid)) return;

    void (async () => {
      try {
        const db = getFirebaseDb();
        const iso = new Date().toISOString();
        const ch: WorkspaceChatChannel = {
          id: gid,
          organizationId,
          kind: "public",
          slug: "general",
          name: "general",
          createdById: currentUserId,
          createdAt: iso,
        };
        await persistWorkspaceChatChannelCreate(db, organizationId, ch);
      } catch {
        /* another client may have created it */
      }
    })();
  }, [isDemo, organizationId, currentUserId, loading, liveChannels]);

  /** Live: subscribe messages for selected channel. */
  React.useEffect(() => {
    if (isDemo || !organizationId || !selectedChannelId || !isFirebaseWebConfigured()) {
      setLiveMessages([]);
      return;
    }

    let db: ReturnType<typeof getFirebaseDb>;
    try {
      db = getFirebaseDb();
    } catch {
      setLiveMessages([]);
      return;
    }

    const qMsg = query(
      collection(db, COLLECTIONS.workspaceChatMessages),
      where("organizationId", "==", organizationId),
      where("channelId", "==", selectedChannelId),
      orderBy("createdAt", "asc"),
    );
    const unsub = onSnapshot(
      qMsg,
      (snap) => {
        const messages = snap.docs.map((d) => asMessage(d.id, d.data() as Record<string, unknown>));
        setLiveMessages(messages);
      },
      () => setLiveMessages([]),
    );
    return () => unsub();
  }, [isDemo, organizationId, selectedChannelId]);

  const channels = isDemo ? demoChannels : liveChannels;
  const messages = isDemo
    ? demoMessages.filter((m) => m.channelId === selectedChannelId)
    : liveMessages;

  React.useEffect(() => {
    if (!selectedChannelId && channels.length > 0) {
      const general = channels.find((c) => c.slug === "general") ?? channels[0];
      if (general) setSelectedChannelId(general.id);
    }
  }, [channels, selectedChannelId]);

  const sendMessage = React.useCallback(
    async (body: string, mentionUserIds: string[]) => {
      const trimmed = body.trim();
      if (!trimmed || !selectedChannelId || !currentUserId) return;
      const iso = new Date().toISOString();
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `msg-${crypto.randomUUID()}`
          : `msg-${Date.now()}`;

      const msg: WorkspaceChatMessage = {
        id,
        organizationId: orgKey,
        channelId: selectedChannelId,
        authorId: currentUserId,
        body: trimmed,
        mentionUserIds: mentionUserIds.length ? Array.from(new Set(mentionUserIds)) : undefined,
        createdAt: iso,
      };

      if (isDemo) {
        demoAppendMessage(DEMO_CHAT_ORG, { ...msg, organizationId: DEMO_CHAT_ORG });
        return;
      }
      if (!organizationId || !isFirebaseWebConfigured()) return;
      try {
        const db = getFirebaseDb();
        await persistWorkspaceChatMessageCreate(db, organizationId, {
          ...msg,
          organizationId,
        });
      } catch (e) {
        throw e instanceof Error ? e : new Error(String(e));
      }
    },
    [
      selectedChannelId,
      currentUserId,
      orgKey,
      isDemo,
      organizationId,
      demoAppendMessage,
    ],
  );

  const createPublicChannel = React.useCallback(
    async (nameRaw: string) => {
      const name = nameRaw.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
      if (!name || !currentUserId) return;
      const slug = name.replace(/^#/, "");
      const existingList = isDemo
        ? (useTeamChatDemoStore.getState().channelsByOrg[DEMO_CHAT_ORG] ?? [])
        : channels;
      if (existingList.some((c) => c.kind === "public" && c.slug === slug)) {
        throw new Error("A channel with that name already exists.");
      }
      const iso = new Date().toISOString();
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `ch-${crypto.randomUUID()}`
          : `ch-${Date.now()}`;
      const ch: WorkspaceChatChannel = {
        id,
        organizationId: orgKey,
        kind: "public",
        slug,
        name: slug,
        createdById: currentUserId,
        createdAt: iso,
      };
      if (isDemo) {
        demoUpsertChannel(DEMO_CHAT_ORG, { ...ch, organizationId: DEMO_CHAT_ORG });
        setSelectedChannelId(id);
        return;
      }
      if (!organizationId) return;
      const db = getFirebaseDb();
      await persistWorkspaceChatChannelCreate(db, organizationId, {
        ...ch,
        organizationId,
      });
      setSelectedChannelId(id);
    },
    [channels, currentUserId, orgKey, isDemo, organizationId, demoUpsertChannel],
  );

  const openOrCreateDm = React.useCallback(
    async (otherUserId: string) => {
      if (!currentUserId || otherUserId === currentUserId) return;
      const id = dmChannelId(currentUserId, otherUserId);
      const iso = new Date().toISOString();

      if (isDemo) {
        const chs = useTeamChatDemoStore.getState().channelsByOrg[DEMO_CHAT_ORG] ?? [];
        if (!chs.some((c) => c.id === id)) {
          const ch: WorkspaceChatChannel = {
            id,
            organizationId: DEMO_CHAT_ORG,
            kind: "dm",
            slug: `dm-${id.slice(-8)}`,
            name: "Direct message",
            memberIds: [currentUserId, otherUserId].sort(),
            createdById: currentUserId,
            createdAt: iso,
          };
          demoUpsertChannel(DEMO_CHAT_ORG, ch);
        }
        setSelectedChannelId(id);
        return;
      }
      if (!organizationId || !isFirebaseWebConfigured()) return;
      const exists = liveChannels.some((c) => c.id === id);
      const db = getFirebaseDb();
      if (!exists) {
        const ch: WorkspaceChatChannel = {
          id,
          organizationId,
          kind: "dm",
          slug: `dm-${id.slice(-8)}`,
          name: "Direct message",
          memberIds: [currentUserId, otherUserId].sort(),
          createdById: currentUserId,
          createdAt: iso,
        };
        await persistWorkspaceChatChannelCreate(db, organizationId, ch);
      }
      setSelectedChannelId(id);
    },
    [currentUserId, isDemo, organizationId, liveChannels, demoUpsertChannel],
  );

  return {
    organizationId: effectiveOrgId,
    channels,
    messages,
    selectedChannelId,
    setSelectedChannelId,
    sendMessage,
    createPublicChannel,
    openOrCreateDm,
    loading: !isDemo && loading,
    error,
    /** False when live org is missing or Firebase env is not set up. */
    liveChatAvailable: Boolean(!isDemo && organizationId && isFirebaseWebConfigured()),
  };
}
