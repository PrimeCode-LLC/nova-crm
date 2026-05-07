"use client";

import * as React from "react";
import Link from "next/link";
import { Hash, Loader2, MessageCirclePlus, MessagesSquare, Send, UserPlus } from "lucide-react";
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
  if (ch.kind !== "dm" || !ch.memberIds?.length) return `#${ch.name}`;
  const other = ch.memberIds.find((id) => id !== selfId);
  const u = users.find((x) => x.id === other);
  return u?.displayName?.trim() ? u.displayName : "Direct message";
}

type Props = {
  users: User[];
  currentUserId: string;
  isDemo: boolean;
  organizationId: string | undefined;
};

export function WorkspaceTeamChatPanel({ users, currentUserId, isDemo, organizationId }: Props) {
  const chat = useWorkspaceTeamChat({ organizationId, isDemo, currentUserId });
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [newChOpen, setNewChOpen] = React.useState(false);
  const [newChName, setNewChName] = React.useState("");
  const [mentionOpen, setMentionOpen] = React.useState(false);
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

  React.useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages.length, chat.selectedChannelId]);

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
      <div className="flex w-full max-w-[280px] shrink-0 flex-col border-r bg-muted/10">
        <div className="border-b px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Channels</p>
          <div className="mt-2 flex gap-1">
            <Button variant="outline" size="sm" className="h-7 flex-1 text-xs" onClick={() => setNewChOpen(true)}>
              <Hash className="mr-1 h-3 w-3" />
              New
            </Button>
          </div>
        </div>
        <ScrollArea className="flex-1">
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
                {publicChannels.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => chat.setSelectedChannelId(ch.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60",
                      chat.selectedChannelId === ch.id && "bg-muted font-medium",
                    )}
                  >
                    <Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{ch.name}</span>
                  </button>
                ))}
              </div>
            </div>
            {dmChannels.length > 0 && (
              <div>
                <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Direct messages
                </p>
                <div className="space-y-0.5">
                  {dmChannels.map((ch) => (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => chat.setSelectedChannelId(ch.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60",
                        chat.selectedChannelId === ch.id && "bg-muted font-medium",
                      )}
                    >
                      <MessageCirclePlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{channelTitle(ch, currentUserId, users)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Teammates
              </p>
              <div className="space-y-0.5">
                {others.map((u) => (
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
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          {selected?.kind === "public" ? (
            <Hash className="h-4 w-4 text-muted-foreground" />
          ) : (
            <MessageCirclePlus className="h-4 w-4 text-muted-foreground" />
          )}
          <h2 className="truncate text-sm font-semibold">
            {selected ? channelTitle(selected, currentUserId, users) : "Select a channel"}
          </h2>
        </div>

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
            <div ref={listEndRef} />
          </div>
        </ScrollArea>

        <div className="border-t p-3 space-y-2 bg-muted/10">
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
