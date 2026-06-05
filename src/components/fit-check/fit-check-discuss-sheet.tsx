"use client";

import * as React from "react";
import { Loader2, Send } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { OpportunityFitMessage, OpportunityFitScan } from "@/lib/ai/opportunity-fit-types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const SUGGESTED = [
  "Why this verdict?",
  "What's the biggest risk?",
  "Rewrite hook 1 for LinkedIn",
  "Should I skip this one?",
];

export function FitCheckDiscussSheet({
  open,
  onOpenChange,
  scan,
  isDemo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scan: OpportunityFitScan | null;
  isDemo: boolean;
}) {
  const [messages, setMessages] = React.useState<OpportunityFitMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [loadingHistory, setLoadingHistory] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open || !scan?.id) return;
    setLoadingHistory(true);
    void fetch(`/api/ai/opportunity-fit/scans/${scan.id}/messages`, { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { messages?: OpportunityFitMessage[] };
        setMessages(data.messages ?? []);
      })
      .finally(() => setLoadingHistory(false));
  }, [open, scan?.id]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    if (!scan?.id || !text.trim() || loading) return;
    setLoading(true);
    const userMsg = text.trim();
    setInput("");
    setMessages((m) => [
      ...m,
      {
        id: `local-${Date.now()}`,
        role: "user",
        content: userMsg,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const res = await fetch(`/api/ai/opportunity-fit/scans/${scan.id}/messages`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg, demo: isDemo }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not get a reply");
        return;
      }
      if (data.reply) {
        setMessages((m) => [
          ...m,
          {
            id: `local-a-${Date.now()}`,
            role: "assistant",
            content: data.reply!,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col gap-0 p-0">
        <SheetHeader className="px-4 pt-4 pb-2 border-b shrink-0">
          <SheetTitle className="text-base">Discuss this check</SheetTitle>
          <SheetDescription className="text-xs line-clamp-2">
            {scan?.title ?? "Opportunity"}, scoped to this scan only.
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
                Ask anything about this opportunity, score, hooks, or whether to spend time on it.
              </p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm max-w-[95%] whitespace-pre-wrap",
                  m.role === "user"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "mr-auto bg-muted border",
                )}
              >
                {m.content}
              </div>
            ))}
            {loading && (
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
              </p>
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        <div className="border-t p-3 space-y-2 shrink-0">
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED.map((q) => (
              <Button
                key={q}
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 text-xs"
                disabled={loading || !scan}
                onClick={() => void send(q)}
              >
                {q}
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a follow-up…"
              rows={2}
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
              disabled={loading || !input.trim()}
              onClick={() => void send(input)}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
