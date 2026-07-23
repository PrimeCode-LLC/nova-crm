"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { AppPage, PageBody, PageHeader } from "@/components/common/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/permissions/can";
import { cn } from "@/lib/utils";
import { useNavAccessContext } from "@/lib/hooks/use-nav-access-context";
import { useContentCalendarData } from "@/lib/hooks/use-content-calendar-data";
import { fmtRelative } from "@/lib/format";

export function ContentCaptureClient() {
  const navAccess = useNavAccessContext();
  const data = useContentCalendarData();
  const permissionSubject = React.useMemo(
    () => ({
      roleId: navAccess.roleId ?? "salesperson",
      isSuperAdmin: Boolean(navAccess.isSuperAdmin),
      featureGrants: navAccess.featureGrants,
      orgRole: navAccess.orgRole,
      roleSnapshot: navAccess.roleSnapshot,
    }),
    [navAccess],
  );
  const canCreate = can(permissionSubject, "content_calendar", "create");

  const [brandId, setBrandId] = React.useState("");
  const [problem, setProblem] = React.useState("");
  const [solution, setSolution] = React.useState("");
  const [outcome, setOutcome] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [publicSafe, setPublicSafe] = React.useState(true);
  const [queueForPosts, setQueueForPosts] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!brandId && data.brands[0]) setBrandId(data.brands[0].id);
  }, [data.brands, brandId]);

  async function submit() {
    if (!canCreate) return;
    if (!problem.trim() || !solution.trim()) {
      toast.error("Problem and solution are required");
      return;
    }
    setBusy(true);
    try {
      const capture = await data.createCapture({
        brandId: brandId || undefined,
        problem: problem.trim(),
        solution: solution.trim(),
        outcome: outcome.trim() || undefined,
        notes: notes.trim() || undefined,
        publicSafe,
        queueForPosts,
      });
      if (!capture) {
        toast.error("Could not save capture");
        return;
      }

      const res = await fetch("/api/ai/content-capture-normalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ captureId: capture.id }),
      });
      const json = (await res.json()) as { error?: string; title?: string };
      if (!res.ok) {
        toast.error(json.error || "Normalize / index failed");
        return;
      }
      toast.success(json.title ? `Indexed: ${json.title}` : "Captured and indexed");
      setProblem("");
      setSolution("");
      setOutcome("");
      setNotes("");
    } catch {
      toast.error("Capture failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppPage>
      <PageHeader
        title="Capture"
        description="Turn today’s problem → solution into a RAG case study for future posts, emails, and Fit Check."
        actions={
          <Link href="/content" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Calendar
          </Link>
        }
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">New capture</CardTitle>
              <CardDescription>~60 seconds. AI structures it and indexes to knowledge.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Brand (optional)</Label>
                <Select
                  value={brandId || "none"}
                  onValueChange={(v) => setBrandId(!v || v === "none" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Brand" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Org default library</SelectItem>
                    {data.brands.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Problem</Label>
                <Textarea
                  value={problem}
                  onChange={(e) => setProblem(e.target.value)}
                  rows={3}
                  placeholder="What went wrong or what the client needed…"
                />
              </div>
              <div className="space-y-2">
                <Label>Solution</Label>
                <Textarea
                  value={solution}
                  onChange={(e) => setSolution(e.target.value)}
                  rows={3}
                  placeholder="What you did…"
                />
              </div>
              <div className="space-y-2">
                <Label>Outcome (optional)</Label>
                <Textarea
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  rows={2}
                  placeholder="Result, metric, or lesson…"
                />
              </div>
              <div className="space-y-2">
                <Label>Extra notes</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={publicSafe} onCheckedChange={(c) => setPublicSafe(c === true)} />
                Public-safe (ok to use in posts)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={queueForPosts}
                  onCheckedChange={(c) => setQueueForPosts(c === true)}
                />
                Flag for upcoming content plan
              </label>
              <Button type="button" onClick={() => void submit()} disabled={busy || !canCreate}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Capture &amp; index
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent captures</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.captures.length === 0 ? (
                <p className="text-sm text-muted-foreground">No captures yet.</p>
              ) : (
                [...data.captures]
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .slice(0, 20)
                  .map((c) => (
                    <div key={c.id} className="rounded-md border px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium line-clamp-1">
                          {c.normalizedTitle || c.problem.slice(0, 80)}
                        </span>
                        <Badge variant="secondary">{c.status}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {fmtRelative(c.createdAt)}
                        {c.publicSafe ? " · public-safe" : " · internal"}
                        {c.queueForPosts ? " · queued" : ""}
                      </div>
                    </div>
                  ))
              )}
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </AppPage>
  );
}
