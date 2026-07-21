"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ExternalLink, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  PROSPECT_DRAFT_FIELD_KEYS,
  type ProspectDraft,
  type ProspectDraftFieldKey,
} from "@/lib/prospects/draft-types";

const LABELS: Record<ProspectDraftFieldKey, string> = {
  companyName: "Company name",
  companyDomain: "Company domain",
  companyWebsite: "Company website",
  companyLinkedIn: "Company LinkedIn",
  industry: "Industry",
  businessDescription: "Business description",
  city: "City",
  state: "State / region",
  country: "Country",
  yearFounded: "Year founded",
  companySize: "Company size",
  revenueRange: "Revenue range",
  techStack: "Tech stack",
  contactName: "Contact name",
  firstName: "First name",
  lastName: "Last name",
  contactTitle: "Contact title",
  contactEmail: "Contact email",
  contactPhone: "Contact phone",
  contactLinkedIn: "Contact LinkedIn",
  triggerEvent: "Trigger event",
  painPoints: "Pain points",
  businessFocus: "Business focus",
  hiringSignals: "Hiring signals",
  recentNews: "Recent news",
  notes: "Notes",
};

const LONG_FIELDS = new Set<ProspectDraftFieldKey>([
  "businessDescription",
  "triggerEvent",
  "painPoints",
  "businessFocus",
  "hiringSignals",
  "recentNews",
  "notes",
]);

async function loadDraft(id: string): Promise<ProspectDraft> {
  const response = await fetch(`/api/prospect-drafts/${encodeURIComponent(id)}`);
  const body = (await response.json()) as { draft?: ProspectDraft; error?: string };
  if (!response.ok || !body.draft) throw new Error(body.error ?? "Draft not found.");
  return body.draft;
}

async function saveValues(
  id: string,
  values: Partial<Record<ProspectDraftFieldKey, string>>,
): Promise<ProspectDraft> {
  const response = await fetch(`/api/prospect-drafts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
  const body = (await response.json()) as { draft?: ProspectDraft; error?: string };
  if (!response.ok || !body.draft) throw new Error(body.error ?? "Could not save draft.");
  return body.draft;
}

function DraftForm({ draft }: { draft: ProspectDraft }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [values, setValues] = React.useState<Partial<Record<ProspectDraftFieldKey, string>>>(
    Object.fromEntries(
      PROSPECT_DRAFT_FIELD_KEYS.map((key) => [key, draft.fields[key]?.value ?? ""]),
    ),
  );
  const [busy, setBusy] = React.useState<"save" | "complete" | "discard" | null>(null);
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [discardReason, setDiscardReason] = React.useState("");

  async function persist(showToast = true) {
    const updated = await saveValues(draft.id, values);
    queryClient.setQueryData(["prospect-draft", draft.id], updated);
    void queryClient.invalidateQueries({ queryKey: ["prospect-drafts"] });
    if (showToast) toast.success("Draft saved");
    return updated;
  }

  async function handleSave() {
    setBusy("save");
    try {
      await persist();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save draft.");
    } finally {
      setBusy(null);
    }
  }

  async function handleComplete() {
    setBusy("complete");
    try {
      const updated = await persist(false);
      if (updated.missingRequiredFields.length) {
        throw new Error(`Complete ${updated.missingRequiredFields.map((key) => LABELS[key]).join(" and ")}.`);
      }
      const response = await fetch(
        `/api/prospect-drafts/${encodeURIComponent(draft.id)}/complete`,
        { method: "POST" },
      );
      const body = (await response.json()) as { leadId?: string; error?: string };
      if (!response.ok || !body.leadId) throw new Error(body.error ?? "Could not complete draft.");
      toast.success("Draft completed and prospect created");
      void queryClient.invalidateQueries({ queryKey: ["prospect-drafts"] });
      router.push(`/leads/${body.leadId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not complete draft.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDiscard() {
    if (!discardReason.trim()) return;
    setBusy("discard");
    try {
      const response = await fetch(`/api/prospect-drafts/${encodeURIComponent(draft.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: discardReason }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not discard draft.");
      toast.success("Draft discarded");
      setDiscardOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["prospect-drafts"] });
      router.push("/prospects");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not discard draft.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="border-amber-500/35 bg-amber-500/5">
        <CardContent className="space-y-3 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">Working draft · {draft.completionPercent}% complete</p>
              <p className="text-sm text-muted-foreground">
                AI suggestions remain proposed until you review and save them.
              </p>
            </div>
            <div className="flex gap-2">
              {draft.strategy ? <Badge variant="outline">{draft.strategy.strategyName}</Badge> : null}
              {typeof draft.qualityScore === "number" ? (
                <Badge variant="secondary">Intent {draft.qualityScore}/100</Badge>
              ) : null}
            </div>
          </div>
          <Progress value={draft.completionPercent} className="h-2" />
          {draft.missingRequiredFields.length ? (
            <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              Required: {draft.missingRequiredFields.map((key) => LABELS[key]).join(", ")}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
              <Check className="h-4 w-4" /> Required fields are complete.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Prospect fields</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {PROSPECT_DRAFT_FIELD_KEYS.map((key) => {
            const field = draft.fields[key];
            const controlProps = {
              value: values[key] ?? "",
              onChange: (
                event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
              ) => setValues((current) => ({ ...current, [key]: event.target.value })),
              placeholder: `Add ${LABELS[key].toLocaleLowerCase()}`,
            };
            return (
              <div
                key={key}
                className={LONG_FIELDS.has(key) ? "space-y-2 md:col-span-2" : "space-y-2"}
              >
                <div className="flex items-center justify-between gap-2">
                  <label className="text-sm font-medium">{LABELS[key]}</label>
                  {field ? (
                    <Badge
                      variant={field.status === "conflict" ? "destructive" : "outline"}
                      className="text-[10px]"
                    >
                      {field.status} · {Math.round(field.confidence * 100)}%
                    </Badge>
                  ) : null}
                </div>
                {LONG_FIELDS.has(key) ? (
                  <Textarea {...controlProps} rows={3} />
                ) : (
                  <Input {...controlProps} />
                )}
                {field?.evidence[0] ? (
                  <blockquote className="border-l-2 pl-3 text-xs text-muted-foreground">
                    “{field.evidence[0].quote}”{" "}
                    <a
                      href={field.evidence[0].sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center text-primary hover:underline"
                    >
                      source <ExternalLink className="ml-1 h-3 w-3" />
                    </a>
                  </blockquote>
                ) : null}
                {field?.status === "conflict" && field.alternatives?.length ? (
                  <div className="rounded-md border border-destructive/30 p-2 text-xs">
                    Conflict:{" "}
                    {field.alternatives.map((alternative) => alternative.value).join(" · ")}
                  </div>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Captured sources ({draft.sourceCount})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {draft.sources.map((source) => (
            <a
              key={source.id}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm hover:bg-muted/50"
            >
              <span className="min-w-0 truncate">{source.title || source.domain}</span>
              <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
            </a>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="destructive"
          onClick={() => setDiscardOpen(true)}
          disabled={Boolean(busy)}
        >
          <Trash2 className="h-4 w-4" /> Discard draft
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSave} disabled={Boolean(busy)}>
            <Save className="h-4 w-4" /> {busy === "save" ? "Saving…" : "Save draft"}
          </Button>
          <Button onClick={handleComplete} disabled={Boolean(busy)}>
            <Check className="h-4 w-4" />{" "}
            {busy === "complete" ? "Completing…" : "Complete prospect"}
          </Button>
        </div>
      </div>
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this working draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Its captured sources and AI suggestions will remain in the audit record, but it
              cannot be resumed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={discardReason}
            onChange={(event) => setDiscardReason(event.target.value)}
            placeholder="Reason for discarding"
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(busy)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!discardReason.trim() || Boolean(busy)}
              onClick={handleDiscard}
            >
              {busy === "discard" ? "Discarding…" : "Discard draft"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function ProspectDraftEditor({ draftId }: { draftId: string }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ["prospect-draft", draftId],
    queryFn: () => loadDraft(draftId),
  });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading draft…</p>;
  if (error || !data) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Draft not found."}
        </p>
        <Button variant="outline" nativeButton={false} render={<Link href="/prospects">Back</Link>} />
      </div>
    );
  }
  return <DraftForm key={data.updatedAt} draft={data} />;
}
