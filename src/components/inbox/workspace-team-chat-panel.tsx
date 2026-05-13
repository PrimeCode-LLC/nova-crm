"use client";

import * as React from "react";
import Link from "next/link";
import { Hash, Loader2, MessageCirclePlus, MessagesSquare, Search, Send, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyState } from "@/components/common/empty-state";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { fmtRelative } from "@/lib/format";
import { useWorkspaceTeamChat } from "@/lib/hooks/use-workspace-team-chat";
import { useTeamChatUnread } from "@/components/providers/team-chat-unread-provider";
import { extractMentionUserIds, formatChatBodySegments } from "@/lib/team-chat-mentions";
import type { User, WorkspaceChatChannel, WorkspaceChatMessage } from "@/lib/types";
import { toast } from "sonner";

function initials(name: string) {
  return name
    .split(" ")
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
}

function channelTitle(ch: WorkspaceChatChannel, selfId: string, users: User[]) {
  if (ch.kind !== "dm" || !ch.memberIds?.length) {
    const n = ch.name?.trim() || ch.slug || "channel";
    return n.startsWith("#") ? n.slice(1) : n;
  }
  const other = ch.memberIds.find((id) => id !== selfId);
  const u = users.find((x) => x.id === other);
  return u?.displayName?.trim() ? u.displayName : "Direct message";
}

/** Firebase SDK embeds this URL when a composite index is missing. */
function extractFirebaseIndexCreateUrl(message: string): string | null {
  const m = message.match(/https:\/\/console\.firebase\.google\.com[^\s]+/i);
  if (!m) return null;
  return m[0].replace(/[)\]"'.,;:]+$/, "");
}

function messageWithoutIndexUrl(message: string, url: string | null): string {
  if (!url) return message;
  return message.replace(url, "").replace(/\s{2,}/g, " ").trim();
}

function UnreadCountBadge({ count }: { count: number }) {
  if (count < 1) return null;
  const label = count > 99 ? "99+" : String(count);
  return (
    <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-bold tabular-nums text-foreground ring-1 ring-border">
      {label}
    </span>
  );
}

type Props = {
  users: User[];
  currentUserId: string;
  isDemo: boolean;
  organizationId: string | undefined;
};

export function WorkspaceTeamChatPanel({ users, currentUserId, isDemo, organizationId }: Props) {
  const chat = useWorkspaceTeamChat({ organizationId, isDemo, currentUserId });
  const { teamChatUnreadByChannel, markTeamChatChannelRead, registerTeamChatSelection } =
    useTeamChatUnread();

  React.useEffect(() => {
    registerTeamChatSelection(chat.selectedChannelId);
    return () => registerTeamChatSelection(null);
  }, [chat.selectedChannelId, registerTeamChatSelection]);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [newChOpen, setNewChOpen] = React.useState(false);
  const [newChName, setNewChName] = React.useState("");
  const [mentionOpen, setMentionOpen] = React.useState(false);
  const [teammateQuery, setTeammateQuery] = React.useState("");
  const listEndRef = React.useRef<HTMLDivElement>(null);

  const usersById = React.useMemo(() => {
    const m = new Map<string, User>();
    for (const u of users) m.set(u.id, u);
    return m;
  }, [users]);

  const selected = chat.channels.find((c) => c.id === chat.selectedChannelId) ?? null;
  const publicChannels = chat.channels.filter((c) => c.kind === "public");
  const dmChannels = chat.channels.filter((c) => c.kind === "dm");

  const others = users.filter((u) => u.id !== currentUserId);

  const otherUserIdsWithDm = React.useMemo(() => {
    const ids = new Set<string>();
    for (const ch of dmChannels) {
      if (ch.kind !== "dm" || !ch.memberIds?.length) continue;
      const other = ch.memberIds.find((id) => id !== currentUserId);
      if (other) ids.add(other);
    }
    return ids;
  }, [dmChannels, currentUserId]);

  const teammatesNotInDmList = React.useMemo(
    () => others.filter((u) => !otherUserIdsWithDm.has(u.id)),
    [others, otherUserIdsWithDm],
  );

  const teammateSearch = teammateQuery.trim().toLowerCase();
  const filteredTeammates = React.useMemo(() => {
    if (!teammateSearch) return teammatesNotInDmList;
    return teammatesNotInDmList.filter((u) => {
      const name = u.displayName.toLowerCase();
      const email = u.email.toLowerCase();
      return name.includes(teammateSearch) || email.includes(teammateSearch);
    });
  }, [teammatesNotInDmList, teammateSearch]);

  React.useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages.length, chat.selectedChannelId]);

  const lastMarkedRef = React.useRef<{ channelId: string; iso: string } | null>(null);
  React.useEffect(() => {
    if (!chat.selectedChannelId) return;
    const readThrough =
      chat.messages.length > 0
        ? chat.messages[chat.messages.length - 1]!.createdAt
        : new Date().toISOString();
    const prev = lastMarkedRef.current;
    if (prev?.channelId === chat.selectedChannelId && prev.iso === readThrough) return;
    lastMarkedRef.current = { channelId: chat.selectedChannelId, iso: readThrough };
    markTeamChatChannelRead(chat.selectedChannelId, readThrough);
  }, [chat.selectedChannelId, chat.messages, markTeamChatChannelRead]);

  async function handleSend() {
    const ids = extractMentionUserIds(draft);
    setSending(true);
    try {
      await chat.sendMessage(draft, ids);
      setDraft("");
    } catch (e) {
      toast.error("Message not sent", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSending(false);
    }
  }

  async function handleCreateChannel() {
    try {
      await chat.createPublicChannel(newChName);
      setNewChName("");
      setNewChOpen(false);
      toast.success("Channel created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create channel");
    }
  }

  function appendMention(userId: string) {
    const token = `@[${userId}]`;
    setDraft((d) => (d.endsWith(" ") || d.length === 0 ? `${d}${token} ` : `${d} ${token} `));
    setMentionOpen(false);
  }

  if (!isDemo && !organizationId) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <EmptyState
          icon={MessagesSquare}
          title="Team chat needs your workspace"
          description="Sign in and join an organization to message your teammates in real time."
        />
      </div>
    );
  }

  if (!isDemo && !chat.liveChatAvailable) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <EmptyState
          icon={MessagesSquare}
          title="Firebase is not configured"
          description="Team chat syncs through Firestore. Add your Firebase web config so messages reach everyone on your team."
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 divide-x">
      <div className="flex min-h-0 w-full max-w-[280px] shrink-0 flex-col border-r bg-muted/10">
        <div className="shrink-0 border-b px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Channels</p>
          <div className="mt-2 flex gap-1">
            <Button variant="outline" size="sm" className="h-7 flex-1 text-xs" onClick={() => setNewChOpen(true)}>
              <Hash className="mr-1 h-3 w-3" />
              New
            </Button>
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-1.5 space-y-3">
            <div>
              {chat.loading && (
                <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading…
                </div>
              )}
              {chat.error && (
                <p className="px-2 py-2 text-xs text-destructive">
                  {chat.error.message}
                  <Link href="/settings" className="ml-1 underline">
                    Settings
                  </Link>
                </p>
              )}
              <div className="space-y-0.5">
                {publicChannels.map((ch) => {
                  const unread = teamChatUnreadByChannel[ch.id] ?? 0;
                  const boldUnread = unread > 0 && chat.selectedChannelId !== ch.id;
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => chat.setSelectedChannelId(ch.id)}
                      className={cn(
                        "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60",
                        chat.selectedChannelId === ch.id && "bg-muted font-medium",
                        boldUnread && "font-semibold text-foreground",
                      )}
                    >
                      <Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{ch.name}</span>
                      <UnreadCountBadge count={unread} />
                    </button>
                  );
                })}
              </div>
            </div>
            {dmChannels.length > 0 && (
              <div>
                <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Direct messages
                </p>
                <div className="space-y-0.5">
                  {dmChannels.map((ch) => {
                    const unread = teamChatUnreadByChannel[ch.id] ?? 0;
                    const boldUnread = unread > 0 && chat.selectedChannelId !== ch.id;
                    return (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={() => chat.setSelectedChannelId(ch.id)}
                        className={cn(
                          "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60",
                          chat.selectedChannelId === ch.id && "bg-muted font-medium",
                          boldUnread && "font-semibold text-foreground",
                        )}
                      >
                        <MessageCirclePlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">
                          {channelTitle(ch, currentUserId, users)}
                        </span>
                        <UnreadCountBadge count={unread} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div>
              <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Teammates
              </p>
              <div className="relative mb-1.5">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={teammateQuery}
                  onChange={(e) => setTeammateQuery(e.target.value)}
                  placeholder="Search by name or email…"
                  className="h-8 pl-7 text-xs"
                  aria-label="Search teammates"
                />
              </div>
              <div className="space-y-0.5">
                {filteredTeammates.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-muted-foreground">
                    {teammateSearch
                      ? "No matches. Try another name or email."
                      : teammatesNotInDmList.length === 0
                        ? "Everyone you DM appears under Direct messages."
                        : "No teammates to show."}
                  </p>
                ) : (
                  filteredTeammates.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => void chat.openOrCreateDm(u.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                    >
                      <Avatar className="h-6 w-6">
                        <AvatarFallback className="text-[9px]">{initials(u.displayName)}</AvatarFallback>
                      </Avatar>
                      <span className="truncate">{u.displayName}</span>
                      <UserPlus className="ml-auto h-3 w-3 opacity-50" />
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
          {selected?.kind === "public" ? (
            <Hash className="h-4 w-4 text-muted-foreground" />
          ) : (
            <MessageCirclePlus className="h-4 w-4 text-muted-foreground" />
          )}
          <h2 className="truncate text-sm font-semibold">
            {selected ? channelTitle(selected, currentUserId, users) : "Select a channel"}
          </h2>
        </div>

        {chat.messageSyncError && !isDemo && (
          <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
            <p className="font-medium">Could not load messages for this channel.</p>
            {(() => {
              const raw = chat.messageSyncError.message;
              const indexUrl = extractFirebaseIndexCreateUrl(raw);
              const summary = messageWithoutIndexUrl(raw, indexUrl);
              return (
                <>
                  {summary ? (
                    <p className="mt-1 text-destructive/90 whitespace-pre-wrap break-words">{summary}</p>
                  ) : null}
                  {indexUrl ? (
                    <p className="mt-2">
                      <a
                        href={indexUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-primary underline-offset-2 hover:underline"
                      >
                        Create index in Firebase console
                      </a>
                    </p>
                  ) : null}
                  {/index/i.test(raw) && (
                    <p className="mt-2 text-muted-foreground">
                      Or deploy indexes from the <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">crm</code> folder:{" "}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">firebase deploy --only firestore:indexes</code>
                      , then wait until the index shows <span className="font-medium text-foreground">Enabled</span> in the Firebase console.
                    </p>
                  )}
                </>
              );
            })()}
          </div>
        )}

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 p-4">
            {!selected && (
              <EmptyState
                icon={MessagesSquare}
                title="Pick a channel"
                description="Choose #general, another channel, or message a teammate."
              />
            )}
            {selected &&
              chat.messages.map((m) => (
                <MessageBubble key={m.id} message={m} usersById={usersById} currentUserId={currentUserId} />
              ))}
            {selected && chat.messages.length === 0 && !chat.messageSyncError && (
              <p className="py-10 text-center text-sm text-muted-foreground">No messages yet — send one below.</p>
            )}
            <div ref={listEndRef} />
          </div>
        </ScrollArea>

        <div className="shrink-0 border-t p-3 space-y-2 bg-muted/10">
          <div className="flex gap-2">
            <Popover open={mentionOpen} onOpenChange={setMentionOpen}>
              <PopoverTrigger
                render={
                  <Button type="button" variant="outline" size="sm" className="h-9 shrink-0 text-xs">
                    @
                  </Button>
                }
              />
              <PopoverContent className="w-64 p-0" align="start">
                <Command>
                  <CommandInput placeholder="Find teammate…" />
                  <CommandList>
                    <CommandEmpty>No one found.</CommandEmpty>
                    <CommandGroup heading="Mention">
                      {others.map((u) => (
                        <CommandItem key={u.id} value={u.displayName} onSelect={() => appendMention(u.id)}>
                          <span className="truncate">{u.displayName}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!sending && draft.trim()) void handleSend();
                }
              }}
              placeholder={selected ? "Message the channel… (Enter to send, Shift+Enter for newline)" : "Select a channel first"}
              disabled={!selected || sending}
              className="min-h-[72px] flex-1 resize-none text-sm"
            />
            <Button
              type="button"
              size="sm"
              className="h-9 shrink-0 self-end"
              disabled={!selected || !draft.trim() || sending}
              onClick={() => void handleSend()}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Messages sync in real time for everyone in your organization. @mentions are highlighted for teammates.
          </p>
        </div>
      </div>

      <Dialog open={newChOpen} onOpenChange={setNewChOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create channel</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers, and hyphens. This will appear as{" "}
              <span className="font-mono text-foreground">#name</span>.
            </p>
            <Input
              value={newChName}
              onChange={(e) => setNewChName(e.target.value)}
              placeholder="e.g. sales-wins"
              className="font-mono text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewChOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreateChannel()} disabled={!newChName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MessageBubble({
  message,
  usersById,
  currentUserId,
}: {
  message: WorkspaceChatMessage;
  usersById: Map<string, User>;
  currentUserId: string;
}) {
  const author = usersById.get(message.authorId);
  const mine = message.authorId === currentUserId;
  const segments = formatChatBodySegments(message.body, usersById);

  return (
    <div className={cn("flex gap-2", mine && "flex-row-reverse")}>
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className="text-[10px]">{initials(author?.displayName ?? "?")}</AvatarFallback>
      </Avatar>
      <div className={cn("min-w-0 max-w-[85%] space-y-0.5", mine && "items-end text-right")}>
        <div className="flex flex-wrap items-baseline gap-2 text-[11px] text-muted-foreground">
          <span className={cn("font-medium text-foreground", mine && "text-primary")}>
            {author?.displayName ?? "Unknown"}
          </span>
          <span>{fmtRelative(message.createdAt)}</span>
        </div>
        <div
          className={cn(
            "rounded-lg border px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words",
            mine ? "bg-primary/10 border-primary/20" : "bg-card",
          )}
        >
          {segments.map((seg, i) =>
            seg.type === "mention" ? (
              <span key={i} className="font-medium text-primary">
                {seg.value}
              </span>
            ) : (
              <span key={i}>{seg.value}</span>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
