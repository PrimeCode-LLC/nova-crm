"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ExternalLink, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ProspectFormSections } from "@/components/prospects/prospect-form-sections";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
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
import { useChannelOptions } from "@/hooks/use-channel-options";
import { countCompanyContactsForUser } from "@/lib/prospecting-strategy/progress";
import { resolveDailyTargets } from "@/lib/prospecting-strategy/types";
import { useProspectingStrategyData } from "@/lib/hooks/use-prospecting-strategy-data";
import {
  domainFromWebsiteOrEmail,
  type ProspectFormValues,
} from "@/lib/prospects/prospect-form";
import {
  DRAFT_FIELD_TO_FORM_KEY,
  PROSPECT_DRAFT_FIELD_KEYS,
  prospectFormFromDraft,
  type ProspectDraft,
  type ProspectDraftFieldKey,
} from "@/lib/prospects/draft-types";
import { reviewedKeysAfterDraftSave } from "@/lib/prospects/draft-autosave";
import { cn } from "@/lib/utils";

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
  form: ProspectFormValues,
  revision: number,
): Promise<ProspectDraft> {
  const response = await fetch(`/api/prospect-drafts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values, form, revision }),
  });
  const body = (await response.json()) as {
    draft?: ProspectDraft;
    error?: string;
    code?: string;
  };
  if (response.status === 409 || body.code === "revision_conflict") {
    throw new DraftConflictError(body.error ?? "This draft changed elsewhere.");
  }
  if (!response.ok || !body.draft) throw new Error(body.error ?? "Could not save draft.");
  return body.draft;
}

class DraftConflictError extends Error {}

function DraftAnnotation({
  draft,
  fieldKey,
}: {
  draft: ProspectDraft;
  fieldKey: ProspectDraftFieldKey;
}) {
  const field = draft.fields[fieldKey];
  if (!field) return null;
  const details = [
    field.evidence[0]?.quote,
    field.alternatives?.length
      ? `Alternatives: ${field.alternatives.map((item) => item.value).join(" · ")}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span className="inline-flex items-center gap-1">
      <Badge
        variant={field.status === "conflict" ? "destructive" : "outline"}
        className="text-[10px]"
        title={details}
      >
        {field.status} · {Math.round(field.confidence * 100)}%
      </Badge>
      {field.evidence[0] ? (
        <a
          href={field.evidence[0].sourceUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open evidence for ${LABELS[fieldKey]}`}
          className="text-muted-foreground hover:text-primary"
        >
          <ExternalLink className="size-3" />
        </a>
      ) : null}
    </span>
  );
}

function DraftForm({ draft }: { draft: ProspectDraft }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profiles, leads, currentUserId, intentPlaybook } = useWorkspace();
  const channelOptions = useChannelOptions();
  const prospecting = useProspectingStrategyData();
  const [form, setForm] = React.useState(() => prospectFormFromDraft(draft));
  const [currentDraft, setCurrentDraft] = React.useState(draft);
  const [research, setResearch] = React.useState({
    companyDomain: draft.fields.companyDomain?.value ?? "",
    businessFocus: draft.fields.businessFocus?.value ?? "",
    hiringSignals: draft.fields.hiringSignals?.value ?? "",
    recentNews: draft.fields.recentNews?.value ?? "",
  });
  const [reviewedKeys, setReviewedKeys] = React.useState<Set<ProspectDraftFieldKey>>(
    () => new Set(),
  );
  const [values, setValues] = React.useState<Partial<Record<ProspectDraftFieldKey, string>>>(
    Object.fromEntries(
      PROSPECT_DRAFT_FIELD_KEYS.map((key) => [key, draft.fields[key]?.value ?? ""]),
    ),
  );
  const [busy, setBusy] = React.useState<"save" | "complete" | "discard" | null>(null);
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [qualifyBlockerOpen, setQualifyBlockerOpen] = React.useState(false);
  const [qualifyBlockerMessage, setQualifyBlockerMessage] = React.useState("");
  const [discardReason, setDiscardReason] = React.useState("");
  const latestRevisionRef = React.useRef(draft.revision);
  const latestDraftRef = React.useRef(draft);
  const formRef = React.useRef(form);
  const researchRef = React.useRef(research);
  const reviewedKeysRef = React.useRef(reviewedKeys);
  const editVersionRef = React.useRef(0);
  const savePromiseRef = React.useRef<Promise<ProspectDraft> | null>(null);
  const [revision, setRevision] = React.useState(draft.revision);
  const [lastSavedAt, setLastSavedAt] = React.useState(draft.lastSavedAt);
  const [saveState, setSaveState] = React.useState<
    "saved" | "unsaved" | "saving" | "error" | "conflict"
  >(
    "saved",
  );

  const persist = React.useCallback(async (showToast = true) => {
    if (savePromiseRef.current) {
      await savePromiseRef.current;
    }
    const keys = new Set(reviewedKeysRef.current);
    if (keys.size === 0) return latestDraftRef.current;
    const capturedForm = formRef.current;
    const capturedResearch = researchRef.current;
    const capturedEditVersion = editVersionRef.current;
    setSaveState("saving");
    const values: Partial<Record<ProspectDraftFieldKey, string>> = {};
    for (const key of keys) {
      if (key in capturedResearch) {
        values[key] = capturedResearch[key as keyof typeof capturedResearch];
        continue;
      }
      const formKey = DRAFT_FIELD_TO_FORM_KEY[key as keyof typeof DRAFT_FIELD_TO_FORM_KEY];
      if (formKey) values[key] = String(capturedForm[formKey] ?? "");
    }
    if (keys.has("firstName") || keys.has("lastName")) {
      values.contactName = `${capturedForm.firstName} ${capturedForm.lastName}`.trim();
    }
    const operation = saveValues(
      draft.id,
      values,
      capturedForm,
      latestRevisionRef.current,
    ).then((updated) => {
      latestRevisionRef.current = updated.revision;
      latestDraftRef.current = updated;
      setCurrentDraft(updated);
      setRevision(updated.revision);
      setLastSavedAt(updated.lastSavedAt);
      const remaining = reviewedKeysAfterDraftSave(
        reviewedKeysRef.current,
        capturedEditVersion,
        editVersionRef.current,
      );
      reviewedKeysRef.current = remaining;
      setReviewedKeys(remaining);
      if (remaining.size === 0) {
        setSaveState("saved");
      } else {
        setSaveState("unsaved");
      }
      void queryClient.invalidateQueries({ queryKey: ["prospect-drafts"] });
      if (showToast) toast.success("Draft saved");
      return updated;
    });
    savePromiseRef.current = operation;
    try {
      return await operation;
    } finally {
      if (savePromiseRef.current === operation) savePromiseRef.current = null;
    }
  }, [draft.id, queryClient]);

  function markReviewed(key: ProspectDraftFieldKey) {
    editVersionRef.current += 1;
    setReviewedKeys((current) => {
      const next = new Set(current).add(key);
      reviewedKeysRef.current = next;
      return next;
    });
  }

  React.useEffect(() => {
    if (reviewedKeys.size === 0 || busy) return;
    const timer = window.setTimeout(() => {
      void persist(false).catch((error) =>
        setSaveState(error instanceof DraftConflictError ? "conflict" : "error"),
      );
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [busy, persist, reviewedKeys.size]);

  async function handleSave() {
    setBusy("save");
    try {
      await persist();
    } catch (error) {
      setSaveState(error instanceof DraftConflictError ? "conflict" : "error");
      toast.error(error instanceof Error ? error.message : "Could not save draft.");
    } finally {
      setBusy(null);
    }
  }

  async function reloadLatest() {
    setBusy("save");
    try {
      const updated = await loadDraft(draft.id);
      const updatedForm = prospectFormFromDraft(updated);
      latestRevisionRef.current = updated.revision;
      latestDraftRef.current = updated;
      formRef.current = updatedForm;
      reviewedKeysRef.current = new Set();
      setCurrentDraft(updated);
      setForm(updatedForm);
      setResearch({
        companyDomain: updated.fields.companyDomain?.value ?? "",
        businessFocus: updated.fields.businessFocus?.value ?? "",
        hiringSignals: updated.fields.hiringSignals?.value ?? "",
        recentNews: updated.fields.recentNews?.value ?? "",
      });
      setValues(
        Object.fromEntries(
          PROSPECT_DRAFT_FIELD_KEYS.map((key) => [key, updated.fields[key]?.value ?? ""]),
        ),
      );
      setReviewedKeys(new Set());
      setRevision(updated.revision);
      setLastSavedAt(updated.lastSavedAt);
      setSaveState("saved");
      toast.success("Latest draft loaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reload draft.");
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
      await requestCompletion(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not complete draft.";
      if (message.startsWith("Qualification incomplete:")) {
        setQualifyBlockerMessage(message.replace("Qualification incomplete:", "").trim());
        setQualifyBlockerOpen(true);
      } else {
        toast.error(message);
      }
    } finally {
      setBusy(null);
    }
  }

  async function requestCompletion(allowIncomplete: boolean) {
    const response = await fetch(
      `/api/prospect-drafts/${encodeURIComponent(draft.id)}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowIncomplete, revision: latestRevisionRef.current }),
      },
    );
    const body = (await response.json()) as { leadId?: string; error?: string };
    if (!response.ok || !body.leadId) throw new Error(body.error ?? "Could not complete draft.");
    toast.success(
      allowIncomplete
        ? "Prospect created as incomplete"
        : "Draft completed and prospect created",
    );
    void queryClient.invalidateQueries({ queryKey: ["prospect-drafts"] });
    router.push(`/leads/${body.leadId}?from=prospects`);
  }

  async function handleDiscard() {
    if (!discardReason.trim()) return;
    setBusy("discard");
    try {
      const response = await fetch(`/api/prospect-drafts/${encodeURIComponent(draft.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: discardReason, revision: latestRevisionRef.current }),
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

  const selectedStrategy = prospecting.strategies.find((strategy) => strategy.id === form.strategyId);
  const maxContacts = resolveDailyTargets(selectedStrategy).maxContactsPerCompany ?? 2;
  const existingContacts = countCompanyContactsForUser(
    leads,
    currentUserId,
    domainFromWebsiteOrEmail(form.website, form.email),
    form.bizName,
  );

  return (
    <div className="space-y-5">
      <Card className="border-amber-500/35 bg-amber-500/5">
        <CardContent className="space-y-3 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">
                Working draft · {currentDraft.completionPercent}% complete
              </p>
              <p className="text-sm text-muted-foreground">
                AI suggestions remain proposed until you review and save them.
              </p>
              <p
                className={cn(
                  "mt-1 text-xs",
                  saveState === "error" || saveState === "conflict"
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
                role="status"
              >
                {saveState === "saving"
                  ? "Autosaving…"
                  : saveState === "unsaved"
                    ? "Unsaved changes"
                    : saveState === "conflict"
                      ? "Revision conflict — reload the latest version"
                    : saveState === "error"
                      ? "Autosave failed — use Save draft to retry"
                      : `Saved ${new Date(lastSavedAt).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })} · revision ${revision}`}
              </p>
            </div>
            <div className="flex gap-2">
              {currentDraft.strategy ? (
                <Badge variant="outline">{currentDraft.strategy.strategyName}</Badge>
              ) : null}
              {typeof currentDraft.qualityScore === "number" ? (
                <Badge variant="secondary">Intent {currentDraft.qualityScore}/100</Badge>
              ) : null}
            </div>
          </div>
          <Progress value={currentDraft.completionPercent} className="h-2" />
          {currentDraft.missingRequiredFields.length ? (
            <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              Required: {currentDraft.missingRequiredFields.map((key) => LABELS[key]).join(", ")}
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
        <CardContent>
          <ProspectFormSections
            values={form}
            onChange={(next, changedKey) => {
              if (next.strategyId !== form.strategyId) {
                const assignment = prospecting.assignments.find(
                  (item) =>
                    item.userId === currentUserId &&
                    item.strategyId === next.strategyId &&
                    item.status === "active",
                );
                next = {
                  ...next,
                  strategyAssignmentId: assignment?.id ?? "",
                };
              }
              formRef.current = next;
              setForm(next);
              if (changedKey) {
                setSaveState("unsaved");
                markReviewed(changedKey);
              }
            }}
            channelOptions={channelOptions}
            profiles={profiles}
            strategies={prospecting.strategies.filter(
              (strategy) => strategy.status === "published" || strategy.status === "draft",
            )}
            personas={prospecting.personas.filter(
              (persona) => selectedStrategy?.personaIds.includes(persona.id),
            )}
            outreachThreshold={intentPlaybook.outreachThreshold}
            existingContactsForCompany={existingContacts}
            maxContactsPerCompany={maxContacts}
            renderAnnotation={(key) => <DraftAnnotation draft={currentDraft} fieldKey={key} />}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI research</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {(Object.keys(research) as Array<keyof typeof research>).map((key) => {
            const fieldKey = key as ProspectDraftFieldKey;
            const isLong = key !== "companyDomain";
            return (
              <div key={key} className={cn("space-y-2", isLong && "md:col-span-2")}>
                <div className="flex items-center justify-between gap-2">
                  <label className="text-sm font-medium">{LABELS[fieldKey]}</label>
                  <DraftAnnotation draft={currentDraft} fieldKey={fieldKey} />
                </div>
                {isLong ? (
                  <Textarea
                    value={research[key]}
                    rows={3}
                    onChange={(event) => {
                      setSaveState("unsaved");
                      setResearch((current) => {
                        const next = { ...current, [key]: event.target.value };
                        researchRef.current = next;
                        return next;
                      });
                      markReviewed(fieldKey);
                    }}
                  />
                ) : (
                  <Input
                    value={research[key]}
                    onChange={(event) => {
                      setSaveState("unsaved");
                      setResearch((current) => {
                        const next = { ...current, [key]: event.target.value };
                        researchRef.current = next;
                        return next;
                      });
                      markReviewed(fieldKey);
                    }}
                  />
                )}
                {currentDraft.fields[fieldKey]?.evidence[0] ? (
                  <blockquote className="border-l-2 pl-3 text-xs text-muted-foreground">
                    “{currentDraft.fields[fieldKey]!.evidence[0]!.quote}”
                  </blockquote>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {false ? (
      <Card>
        <CardHeader>
          <CardTitle>Legacy prospect fields</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {PROSPECT_DRAFT_FIELD_KEYS.map((key) => {
            const field = currentDraft.fields[key];
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
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Captured sources ({currentDraft.sourceCount})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {currentDraft.sources.map((source) => (
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
          {saveState === "conflict" ? (
            <Button variant="outline" onClick={() => void reloadLatest()} disabled={Boolean(busy)}>
              Reload latest
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={handleSave}
            disabled={Boolean(busy) || saveState === "saving" || saveState === "conflict"}
          >
            <Save className="h-4 w-4" />{" "}
            {busy === "save" || saveState === "saving" ? "Saving…" : "Save draft"}
          </Button>
          <Button
            onClick={handleComplete}
            disabled={Boolean(busy) || saveState === "saving" || saveState === "conflict"}
          >
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
      <AlertDialog open={qualifyBlockerOpen} onOpenChange={setQualifyBlockerOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Qualification not complete</AlertDialogTitle>
            <AlertDialogDescription>{qualifyBlockerMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(busy)}>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(busy)}
              onClick={() => {
                setBusy("complete");
                void requestCompletion(true)
                  .catch((error) => {
                    toast.error(error instanceof Error ? error.message : "Could not complete draft.");
                  })
                  .finally(() => setBusy(null));
              }}
            >
              Create as incomplete
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
  return <DraftForm key={data.id} draft={data} />;
}
