"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Check, Loader2, Plus, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownContent } from "@/components/common/markdown-content";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { buildWorkspaceOwnerPickerOptions } from "@/lib/owner-scope";
import { cn } from "@/lib/utils";
import {
  newProspectingEntityId,
  type ProspectingStrategyData,
} from "@/lib/hooks/use-prospecting-strategy-data";
import {
  applyStrategyFields,
  blankStrategy,
  describeProposal,
  hasFieldChanges,
  planAssignmentChanges,
  type AssistantContext,
  type StrategyProposal,
} from "@/lib/prospecting-strategy/assistant";
import type { StrategyAssistantMessage } from "@/lib/prospecting-strategy/assistant-threads-server";

const API = "/api/ai/strategy-assistant";

const SUGGESTED_LIST = [
  "Create a strategy from my description",
  "Which strategies have nobody assigned?",
];
const SUGGESTED_DETAIL = [
  "Fill in everything that's still empty",
  "Write search queries for this strategy",
  "Assign this 50% to … and 50% to …",
];

/** Chat panel that drafts strategy changes; nothing is saved until the manager clicks Apply. */
export function StrategyAiPanel({
  data,
  focusStrategyId,
}: {
  data: ProspectingStrategyData;
  /** Strategy page id, or null on the list page. */
  focusStrategyId: string | null;
}) {
  const ws = useWorkspace();
  const threadKey = focusStrategyId ?? "general";
  const [open, setOpen] = React.useState(false);
  const [messages, setMessages] = React.useState<StrategyAssistantMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [loadingHistory, setLoadingHistory] = React.useState(false);
  const [applyingId, setApplyingId] = React.useState<string | null>(null);
  const [newTopic, setNewTopic] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  // Latest writers/lists for use after awaits inside applyProposal.
  const dataRef = React.useRef(data);
  React.useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // Same assignable roster as the Assignments tab.
  const users = React.useMemo(() => {
    const ensureIds = [
      ...(ws.activeOrgMemberIds ? [...ws.activeOrgMemberIds] : []),
      ...data.assignments.map((a) => a.userId),
    ];
    const options = buildWorkspaceOwnerPickerOptions(
      ws.users,
      ws.currentUserId,
      ws.getOwnerDisplayName,
      ensureIds,
    );
    if (!ws.activeOrgMemberIds) return options;
    const keep = new Set(ws.activeOrgMemberIds);
    for (const a of data.assignments) keep.add(a.userId);
    if (ws.currentUserId) keep.add(ws.currentUserId);
    return options.filter((o) => keep.has(o.id));
  }, [ws.users, ws.currentUserId, ws.getOwnerDisplayName, ws.activeOrgMemberIds, data.assignments]);

  const context = React.useMemo<AssistantContext>(
    () => ({
      focusStrategyId,
      strategies: data.strategies,
      assignments: data.assignments,
      personas: data.personas
        .filter((p) => p.active)
        .map((p) => ({
          id: p.id,
          name: p.name,
          titles: p.titles.filter((t) => t.kind !== "excluded").map((t) => t.title).slice(0, 50),
        })),
      signals: (ws.intentPlaybook.signals ?? []).map((s) => ({
        id: s.id,
        label: s.label,
        category: s.category,
      })),
      users: users.map((u) => ({ id: u.id, name: u.label })),
    }),
    [focusStrategyId, data.strategies, data.assignments, data.personas, ws.intentPlaybook.signals, users],
  );

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch(`${API}?thread=${encodeURIComponent(threadKey)}`, { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { messages?: StrategyAssistantMessage[] };
        setMessages(body.messages ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, threadKey]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setInput("");
    const pendingId = `local-${Date.now()}`;
    setMessages((m) => [
      ...m,
      {
        id: pendingId,
        role: "user",
        content: message,
        userId: ws.currentUserId,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const res = await fetch(API, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadKey, message, context, newTopic }),
      });
      const body = (await res.json()) as { messages?: StrategyAssistantMessage[]; error?: unknown };
      if (!res.ok || !body.messages) {
        setMessages((m) => m.filter((x) => x.id !== pendingId));
        setInput(message);
        toast.error(typeof body.error === "string" ? body.error : "Could not get a reply");
        return;
      }
      setMessages((m) => [...m.filter((x) => x.id !== pendingId), ...body.messages!]);
      setNewTopic(false);
    } catch {
      setMessages((m) => m.filter((x) => x.id !== pendingId));
      setInput(message);
      toast.error("Network error");
    } finally {
      setSending(false);
    }
  }

  async function markProposal(
    messageId: string,
    status: "applied" | "discarded",
    appliedStrategyId?: string,
  ) {
    setMessages((m) =>
      m.map((x) =>
        x.id === messageId ? { ...x, proposalStatus: status, appliedStrategyId } : x,
      ),
    );
    const res = await fetch(API, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadKey, messageId, status, appliedStrategyId }),
    }).catch(() => null);
    if (!res?.ok) toast.error("The change was handled, but the chat history could not be updated.");
  }

  async function applyProposal(messageId: string, p: StrategyProposal) {
    setApplyingId(messageId);
    const now = new Date().toISOString();
    const uid = ws.currentUserId;
    try {
      let strategyId = p.strategyId;
      if (p.action === "create") {
        const blank = blankStrategy({
          id: newProspectingEntityId("ps"),
          organizationId: data.organizationId,
          userId: uid,
          now,
        });
        const created = applyStrategyFields(blank, p.fields, p.status, uid, now);
        await data.addStrategy(created);
        strategyId = created.id;
        // Assignment notifications read the strategy name from the loaded list,
        // so wait until the new strategy shows up there (as it does when assigning by hand).
        for (let i = 0; i < 50 && !dataRef.current.strategies.some((s) => s.id === created.id); i++) {
          await new Promise((r) => setTimeout(r, 100));
        }
      } else {
        const existing = data.strategies.find((s) => s.id === strategyId);
        if (!existing || !strategyId) throw new Error("That strategy no longer exists.");
        if (hasFieldChanges(p.fields) || p.status) {
          await data.updateStrategy(strategyId, applyStrategyFields(existing, p.fields, p.status, uid, now));
        }
      }

      const live = dataRef.current;
      const plan = planAssignmentChanges({
        strategyId: strategyId!,
        existing: live.assignments,
        assignments: p.assignments,
        removeUserIds: p.removeAssignmentUserIds,
      });
      // Field-for-field what the Assignments tab writes.
      for (const { id, row } of plan.update) {
        await live.updateAssignment(id, {
          assignmentType: row.assignmentType,
          priority: row.assignmentType === "primary" ? 100 : 50,
          allocationPct: row.allocationPct,
          targetOverride: row.targetOverride ?? undefined,
          status: "active",
          updatedAt: now,
        });
      }
      for (const row of plan.add) {
        await live.addAssignment({
          id: newProspectingEntityId("sa"),
          organizationId: data.organizationId,
          strategyId: strategyId!,
          userId: row.userId,
          assignmentType: row.assignmentType,
          priority: row.assignmentType === "primary" ? 100 : 50,
          allocationPct: row.allocationPct,
          targetOverride: row.targetOverride ?? undefined,
          status: "active",
          assignedBy: uid,
          createdAt: now,
          updatedAt: now,
        });
      }
      for (const id of plan.remove) await live.deleteAssignment(id);

      await markProposal(messageId, "applied", strategyId!);
      toast.success(p.action === "create" ? "Strategy created" : "Changes applied");
    } catch (e) {
      toast.error("Could not apply the change", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setApplyingId(null);
    }
  }

  const suggestions = focusStrategyId ? SUGGESTED_DETAIL : SUGGESTED_LIST;

  return (
    <>
      <Button
        size="sm"
        type="button"
        variant="outline"
        onClick={() => {
          setLoadingHistory(true);
          setOpen(true);
        }}
      >
        <Sparkles className="size-4" />
        AI assistant
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-xl flex flex-col gap-0 p-0">
          <SheetHeader className="px-4 pt-4 pb-2 border-b shrink-0">
            <SheetTitle className="text-base">Strategy assistant</SheetTitle>
            <SheetDescription className="text-xs">
              Describe what you want. The assistant drafts the changes and nothing is saved until you
              click Apply.
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1 min-h-0 px-4">
            <div className="py-3 space-y-3 min-h-[200px]">
              {loadingHistory && (
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </p>
              )}
              {!loadingHistory && messages.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {focusStrategyId
                    ? "Ask to fill in or change anything on this strategy, or to assign it to people (e.g. 30% to Ali, 70% to Sara)."
                    : "Describe a strategy and the assistant will fill in every tab, then ask about anything it couldn't work out."}
                </p>
              )}
              {messages.map((m) =>
                m.role === "user" ? (
                  <React.Fragment key={m.id}>
                    {m.topicStart && <TopicDivider />}
                    <div className="ml-auto max-w-[90%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground whitespace-pre-wrap">
                      {m.content}
                    </div>
                  </React.Fragment>
                ) : (
                  <div key={m.id} className="mr-auto max-w-[95%] space-y-2 rounded-lg border bg-muted px-3 py-2">
                    <MarkdownContent>{m.content}</MarkdownContent>
                    {m.questions && m.questions.length > 0 && (
                      <ul className="list-disc pl-4 text-sm space-y-0.5">
                        {m.questions.map((q, i) => (
                          <li key={i}>{q}</li>
                        ))}
                      </ul>
                    )}
                    {m.warnings && m.warnings.length > 0 && (
                      <div className="space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
                        {m.warnings.map((w, i) => (
                          <p key={i} className="flex gap-1.5">
                            <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                            {w}
                          </p>
                        ))}
                      </div>
                    )}
                    {m.proposal && (
                      <ProposalCard
                        proposal={m.proposal}
                        status={m.proposalStatus ?? "pending"}
                        appliedStrategyId={m.appliedStrategyId}
                        showOpenLink={m.appliedStrategyId !== focusStrategyId}
                        context={context}
                        applying={applyingId === m.id}
                        disabled={applyingId !== null}
                        onApply={() => void applyProposal(m.id, m.proposal!)}
                        onDiscard={() => void markProposal(m.id, "discarded")}
                      />
                    )}
                  </div>
                ),
              )}
              {newTopic && <TopicDivider />}
              {sending && (
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
                </p>
              )}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          <div className="border-t p-3 space-y-2 shrink-0">
            <div className="flex flex-wrap gap-1.5">
              {messages.length > 0 && !newTopic && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={sending}
                  title="Earlier messages stay here but the assistant stops using them"
                  onClick={() => setNewTopic(true)}
                >
                  <Plus className="size-3.5" />
                  New topic
                </Button>
              )}
              {suggestions.map((q) => (
                <Button
                  key={q}
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={sending}
                  onClick={() => setInput(q)}
                >
                  {q}
                </Button>
              ))}
            </div>
            <div className="flex gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="e.g. Target logistics companies in Texas with 50–500 staff…"
                rows={3}
                className="min-h-0 resize-none text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
              />
              <Button
                type="button"
                size="icon"
                className="shrink-0 self-end"
                aria-label="Send"
                disabled={sending || !input.trim()}
                onClick={() => void send(input)}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function TopicDivider() {
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      New topic
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function ProposalCard({
  proposal,
  status,
  appliedStrategyId,
  showOpenLink,
  context,
  applying,
  disabled,
  onApply,
  onDiscard,
}: {
  proposal: StrategyProposal;
  status: "pending" | "applied" | "discarded";
  appliedStrategyId?: string;
  showOpenLink: boolean;
  context: AssistantContext;
  applying: boolean;
  disabled: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const lines = describeProposal(proposal, context);
  const target =
    proposal.action === "create"
      ? "New strategy"
      : context.strategies.find((s) => s.id === proposal.strategyId)?.name ?? "Strategy";
  return (
    <div className="rounded-md border bg-background p-2.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">{target}</p>
          <p className="text-sm font-medium">{proposal.summary}</p>
        </div>
        {status !== "pending" && (
          <Badge variant={status === "applied" ? "default" : "secondary"}>
            {status === "applied" ? "Applied" : "Discarded"}
          </Badge>
        )}
      </div>
      <dl className="space-y-1 text-xs">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[8.5rem_1fr] gap-2">
            <dt className="text-muted-foreground">{l.label}</dt>
            <dd className="break-words">{l.value}</dd>
          </div>
        ))}
      </dl>
      {status === "pending" ? (
        <div className="flex gap-2">
          <Button size="sm" type="button" disabled={disabled} onClick={onApply}>
            {applying ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Apply
          </Button>
          <Button size="sm" type="button" variant="ghost" disabled={disabled} onClick={onDiscard}>
            <X className="size-4" />
            Discard
          </Button>
        </div>
      ) : (
        status === "applied" &&
        appliedStrategyId &&
        showOpenLink && (
          <Link
            href={`/admin/strategies/${appliedStrategyId}`}
            className={cn("text-xs font-medium text-primary underline-offset-2 hover:underline")}
          >
            Open strategy
          </Link>
        )
      )}
    </div>
  );
}
