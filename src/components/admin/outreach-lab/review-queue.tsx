"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ThumbsDown, ThumbsUp } from "lucide-react";

const TAGS = [
  "generic",
  "wrong_angle",
  "too_long",
  "hallucinated",
  "weak_cta",
  "good",
] as const;

type QueueItem = {
  id: string;
  configId: string;
  zone: string;
  leadId: string | null;
  accepted: boolean | null;
  output: unknown;
  createdAt: string;
};

function previewOutput(output: unknown): string {
  if (!output || typeof output !== "object") return "(empty)";
  const o = output as Record<string, unknown>;
  if (typeof o.planSummary === "string") return o.planSummary;
  if (Array.isArray(o.items) && o.items[0] && typeof o.items[0] === "object") {
    const first = o.items[0] as Record<string, unknown>;
    return String(first.messageBody ?? first.emailSubject ?? JSON.stringify(first)).slice(0, 400);
  }
  return JSON.stringify(output).slice(0, 400);
}

export function ReviewQueue() {
  const [items, setItems] = React.useState<QueueItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [tagById, setTagById] = React.useState<Record<string, (typeof TAGS)[number]>>({});

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/outreach/review-queue");
      const data = await res.json();
      if (res.ok) setItems(data.items ?? []);
      else toast.error(typeof data.error === "string" ? data.error : "Failed to load queue");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function submit(id: string, thumbs: "up" | "down") {
    const tag = tagById[id] ?? (thumbs === "up" ? "good" : "generic");
    setBusyId(id);
    try {
      const res = await fetch("/api/outreach/review-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationId: id, thumbs, tag }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Submit failed");
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== id));
      toast.success("Labeled");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading review queue…</p>;
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Queue empty. Generate sequences on leads (or run eval) to fill human review samples.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <Card key={item.id}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-mono">{item.id.slice(0, 18)}…</CardTitle>
              <Badge variant="outline">{item.zone}</Badge>
            </div>
            <CardDescription>
              config {item.configId.slice(0, 12)}… · lead {item.leadId ?? "—"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs">
              {previewOutput(item.output)}
            </pre>
            <div className="flex flex-wrap gap-1">
              {TAGS.map((t) => (
                <Button
                  key={t}
                  size="sm"
                  variant={tagById[item.id] === t ? "default" : "outline"}
                  onClick={() => setTagById((m) => ({ ...m, [item.id]: t }))}
                >
                  {t}
                </Button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={busyId === item.id}
                onClick={() => void submit(item.id, "up")}
              >
                <ThumbsUp className="mr-1 h-3.5 w-3.5" /> Up
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === item.id}
                onClick={() => void submit(item.id, "down")}
              >
                <ThumbsDown className="mr-1 h-3.5 w-3.5" /> Down
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
