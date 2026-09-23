"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
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
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useChannelOptions } from "@/hooks/use-channel-options";
import { isLiveCrmSnapshotDisabled } from "@/lib/dashboard-kpi-v2-flags";
import { fetchCompanyProspectCountForMe } from "@/lib/prospects/fetch-company-prospect-count";
import { fetchExactCompanyProspects } from "@/lib/prospects/fetch-company-prospects";
import { countCompanyContactsForUser } from "@/lib/prospecting-strategy/progress";
import {
  collapseAccidentalDoubleName,
  evaluateQualifyGate,
  type QualifyIssue,
} from "@/lib/prospecting-strategy/qualify";
import {
  firstQualifyFieldCode,
  issuesToFieldErrors,
  scrollToProspectField,
} from "@/lib/prospecting-strategy/qualify-field-focus";
import { resolveDailyTargets } from "@/lib/prospecting-strategy/types";
import { useProspectingStrategyData } from "@/lib/hooks/use-prospecting-strategy-data";
import {
  domainFromWebsiteOrEmail,
  type ProspectFormValues,
} from "@/lib/prospects/prospect-form";
import {
  prospectDraftValuesFromForm,
  prospectFormFromDraft,
  type ProspectDraft,
  type ProspectDraftFieldKey,
} from "@/lib/prospects/draft-types";
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

type ResearchValues = {
  companyDomain: string;
  businessFocus: string;
  hiringSignals: string;
  recentNews: string;
};

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
    throw new DraftConflictError(errorMessage(body.error, "This draft changed elsewhere."));
  }
  if (!response.ok || !body.draft) {
    throw new Error(errorMessage(body.error, "Could not save draft."));
  }
  return body.draft;
}

class DraftConflictError extends Error {}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && "formErrors" in error) {
    const formErrors = (error as { formErrors?: string[] }).formErrors?.filter(Boolean) ?? [];
    if (formErrors.length) return formErrors.join(" ");
  }
  return fallback;
}

function stableSnapshot(value: unknown): string {
  return JSON.stringify(sortSnapshot(value));
}

function sortSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortSnapshot);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((sorted, key) => {
        const next = (value as Record<string, unknown>)[key];
        if (next !== undefined) sorted[key] = sortSnapshot(next);
        return sorted;
      }, {});
  }
  return value;
}

function researchFromDraft(draft: ProspectDraft): ResearchValues {
  return {
    companyDomain: draft.fields.companyDomain?.value ?? "",
    businessFocus: draft.fields.businessFocus?.value ?? "",
    hiringSignals: draft.fields.hiringSignals?.value ?? "",
    recentNews: draft.fields.recentNews?.value ?? "",
  };
}

const ResearchFields = React.memo(function ResearchFields({
  draft,
  initialRef,
  resetKey,
  valuesRef,
}: {
  draft: ProspectDraft;
  initialRef: React.MutableRefObject<ResearchValues>;
  resetKey: number;
  valuesRef: React.MutableRefObject<ResearchValues>;
}) {
  const [research, setResearch] = React.useState(initialRef.current);
  const seenResetKey = React.useRef(resetKey);

  React.useEffect(() => {
    if (seenResetKey.current === resetKey) return;
    seenResetKey.current = resetKey;
    setResearch(initialRef.current);
    valuesRef.current = initialRef.current;
  }, [initialRef, resetKey, valuesRef]);

  function update(key: keyof ResearchValues, value: string) {
    setResearch((current) => {
      const next = { ...current, [key]: value };
      valuesRef.current = next;
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI research</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {(Object.keys(research) as Array<keyof ResearchValues>).map((key) => {
          const fieldKey = key as ProspectDraftFieldKey;
          const isLong = key !== "companyDomain";
          return (
            <div key={key} className={cn("space-y-2", isLong && "md:col-span-2")}>
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium">{LABELS[fieldKey]}</label>
                <DraftAnnotation draft={draft} fieldKey={fieldKey} />
              </div>
              {isLong ? (
                <Textarea
                  value={research[key]}
                  rows={3}
                  onChange={(event) => update(key, event.target.value)}
                />
              ) : (
                <Input
                  value={research[key]}
                  onChange={(event) => update(key, event.target.value)}
                />
              )}
              {draft.fields[fieldKey]?.evidence[0] ? (
                <blockquote className="border-l-2 pl-3 text-xs text-muted-foreground">
                  “{draft.fields[fieldKey]!.evidence[0]!.quote}”
                </blockquote>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
});

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
  const { profiles, leads, currentUserId, intentPlaybook, isDemo } = useWorkspace();
  const channelOptions = useChannelOptions();
  const prospecting = useProspectingStrategyData();
  const form = useForm<ProspectFormValues>({
    defaultValues: prospectFormFromDraft(draft),
  });
  const [currentDraft, setCurrentDraft] = React.useState(draft);
  const researchInitialRef = React.useRef(researchFromDraft(draft));
  const researchRef = React.useRef(researchInitialRef.current);
  const researchSavedRef = React.useRef(researchInitialRef.current);
  const [researchResetKey, setResearchResetKey] = React.useState(0);
  const [busy, setBusy] = React.useState<"save" | "complete" | "discard" | null>(null);
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [qualifyBlockerOpen, setQualifyBlockerOpen] = React.useState(false);
  const [qualifyBlockerMessage, setQualifyBlockerMessage] = React.useState("");
  const [qualifyBlockerIssues, setQualifyBlockerIssues] = React.useState<QualifyIssue[]>([]);
  const [fieldErrors, setFieldErrors] = React.useState<Partial<Record<string, string>>>({});
  const skipQualifyScrollRef = React.useRef(false);
  const formScrollRef = React.useRef<HTMLDivElement>(null);
  const [discardReason, setDiscardReason] = React.useState("");
  const latestRevisionRef = React.useRef(draft.revision);
  const latestDraftRef = React.useRef(draft);
  const formBaselineRef = React.useRef("");
  const saveQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const conflictRef = React.useRef(false);
  const busyRef = React.useRef(false);
  const [revision, setRevision] = React.useState(draft.revision);
  const [lastSavedAt, setLastSavedAt] = React.useState(draft.lastSavedAt);
  const [saveState, setSaveState] = React.useState<
    "saved" | "saving" | "error" | "conflict"
  >("saved");

  React.useLayoutEffect(() => {
    formBaselineRef.current = stableSnapshot(form.getValues());
  }, [form]);

  const rememberSavedForm = React.useCallback((nextForm: ProspectFormValues, resetInputs: boolean) => {
    if (resetInputs) form.reset(nextForm);
    formBaselineRef.current = stableSnapshot(resetInputs ? form.getValues() : nextForm);
  }, [form]);

  const persist = React.useCallback(async (options?: { force?: boolean; showToast?: boolean }) => {
    const operation = saveQueueRef.current.catch(() => undefined).then(async () => {
      if (conflictRef.current) {
        throw new DraftConflictError("This draft changed elsewhere. Reload the latest version.");
      }
      const currentForm = form.getValues();
      const capturedForm: ProspectFormValues = {
        ...currentForm,
        qualifyForm: {
          ...currentForm.qualifyForm,
          evidence: currentForm.qualifyForm.evidence.map((row) => ({
            ...row,
            id: row.id || `ev-${crypto.randomUUID()}`,
          })),
        },
      };
      const capturedResearch = researchRef.current;
      const savedResearch = researchSavedRef.current;
      const formDirty = stableSnapshot(capturedForm) !== formBaselineRef.current;
      const researchDirty = (Object.keys(capturedResearch) as Array<keyof ResearchValues>).some(
        (key) => capturedResearch[key] !== savedResearch[key],
      );
      if (!options?.force && !formDirty && !researchDirty) return null;

      setSaveState("saving");
      const values: Partial<Record<ProspectDraftFieldKey, string>> = formDirty
        ? prospectDraftValuesFromForm(capturedForm)
        : {};
      for (const key of Object.keys(capturedResearch) as Array<keyof ResearchValues>) {
        if (capturedResearch[key] !== savedResearch[key]) values[key] = capturedResearch[key];
      }
      const updated = await saveValues(
        draft.id,
        values,
        capturedForm,
        latestRevisionRef.current,
      );
      latestRevisionRef.current = updated.revision;
      latestDraftRef.current = updated;
      const stillCurrent = stableSnapshot(form.getValues()) === stableSnapshot(capturedForm);
      rememberSavedForm(capturedForm, stillCurrent);
      researchSavedRef.current = capturedResearch;
      setCurrentDraft(updated);
      setRevision(updated.revision);
      setLastSavedAt(updated.lastSavedAt);
      setSaveState("saved");
      void queryClient.invalidateQueries({ queryKey: ["prospect-drafts"] });
      if (options?.showToast) toast.success("Draft saved");
      return updated;
    });
    saveQueueRef.current = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }, [draft.id, form, queryClient, rememberSavedForm]);

  async function handleSave() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("save");
    try {
      const updated = await persist({ showToast: true });
      if (!updated) toast.message("No changes to save");
    } catch (error) {
      if (error instanceof DraftConflictError) conflictRef.current = true;
      setSaveState(error instanceof DraftConflictError ? "conflict" : "error");
      toast.error(error instanceof Error ? error.message : "Could not save draft.");
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function reloadLatest() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("save");
    try {
      const updated = await loadDraft(draft.id);
      const updatedForm = prospectFormFromDraft(updated);
      const nextResearch = researchFromDraft(updated);
      latestRevisionRef.current = updated.revision;
      latestDraftRef.current = updated;
      conflictRef.current = false;
      setCurrentDraft(updated);
      rememberSavedForm(updatedForm, true);
      researchInitialRef.current = nextResearch;
      researchRef.current = nextResearch;
      researchSavedRef.current = nextResearch;
      setResearchResetKey((key) => key + 1);
      setFieldErrors({});
      setRevision(updated.revision);
      setLastSavedAt(updated.lastSavedAt);
      setSaveState("saved");
      toast.success("Latest draft loaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reload draft.");
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function handleComplete() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("complete");
    try {
      const updated = (await persist()) ?? latestDraftRef.current;
      if (updated.missingRequiredFields.length) {
        throw new Error(`Complete ${updated.missingRequiredFields.map((key) => LABELS[key]).join(" and ")}.`);
      }
      await requestCompletion(false);
    } catch (error) {
      if (error instanceof DraftConflictError) {
        conflictRef.current = true;
        setSaveState("conflict");
      }
      const message = error instanceof Error ? error.message : "Could not complete draft.";
      if (message.startsWith("Qualification incomplete:")) {
        const nextForm = form.getValues();
        const fullName = collapseAccidentalDoubleName(
          `${nextForm.firstName} ${nextForm.lastName}`.trim(),
        );
        const selected = prospecting.strategies.find((item) => item.id === nextForm.strategyId);
        const max = resolveDailyTargets(selected).maxContactsPerCompany ?? 2;
        const domain = domainFromWebsiteOrEmail(nextForm.website, nextForm.email);
        const companyName = nextForm.bizName.trim();
        let existingContactsForCompany = 0;
        if (isLiveCrmSnapshotDisabled(isDemo) && (domain || companyName)) {
          try {
            existingContactsForCompany = await fetchCompanyProspectCountForMe(
              domain ? { companyDomain: domain } : { companyName },
            );
          } catch {
            const companyLeads = await fetchExactCompanyProspects(
              domain
                ? { intakeKind: "prospect", companyDomain: domain }
                : { intakeKind: "prospect", companyNameExact: companyName },
            );
            existingContactsForCompany = countCompanyContactsForUser(
              companyLeads,
              currentUserId,
              domain,
              companyName,
            );
          }
        } else {
          existingContactsForCompany = countCompanyContactsForUser(
            leads,
            currentUserId,
            domain,
            companyName,
          );
        }
        const gate = evaluateQualifyGate({
          companyName: nextForm.bizName.trim(),
          companyWebsite: nextForm.website.trim(),
          contactName: fullName,
          contactTitle: nextForm.title.trim(),
          contactLinkedIn: nextForm.linkedin.trim(),
          emailVerified: nextForm.emailVerify === "verified",
          intentEvidence: nextForm.qualifyForm.evidence,
          personalizationNote: nextForm.qualifyForm.personalization,
          primaryOpportunityLabel: nextForm.qualifyForm.primaryOpportunityLabel,
          outreachThreshold: intentPlaybook.outreachThreshold,
          existingContactsForCompany,
          maxContactsPerCompany: max,
        });
        const blocking = gate.issues.filter((issue) => issue.blocking);
        setQualifyBlockerIssues(blocking);
        setFieldErrors(issuesToFieldErrors(blocking));
        setQualifyBlockerMessage(message.replace("Qualification incomplete:", "").trim());
        setQualifyBlockerOpen(true);
      } else {
        toast.error(message);
      }
    } finally {
      busyRef.current = false;
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
    const body = (await response.json()) as { leadId?: string; error?: string; code?: string };
    if (response.status === 409 || body.code === "revision_conflict") {
      throw new DraftConflictError(errorMessage(body.error, "This draft changed elsewhere."));
    }
    if (!response.ok || !body.leadId) {
      throw new Error(errorMessage(body.error, "Could not complete draft."));
    }
    toast.success(
      allowIncomplete
        ? "Prospect created as incomplete"
        : "Draft completed and prospect created",
    );
    void queryClient.invalidateQueries({ queryKey: ["prospect-drafts"] });
    router.push(`/leads/${body.leadId}?from=prospects`);
  }

  async function handleDiscard() {
    if (!discardReason.trim() || busyRef.current) return;
    busyRef.current = true;
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
      busyRef.current = false;
      setBusy(null);
    }
  }

  const strategies = prospecting.strategies.filter(
    (strategy) => strategy.status === "published" || strategy.status === "draft",
  );
  const personasForStrategy = React.useCallback(
    (strategyId: string) => {
      const selected = prospecting.strategies.find((strategy) => strategy.id === strategyId);
      if (!selected) return [];
      return prospecting.personas.filter((persona) => selected.personaIds.includes(persona.id));
    },
    [prospecting.personas, prospecting.strategies],
  );
  const assignmentIdForStrategy = React.useCallback(
    (strategyId: string) =>
      prospecting.assignments.find(
        (item) =>
          item.userId === currentUserId &&
          item.strategyId === strategyId &&
          item.status === "active",
      )?.id ?? "",
    [currentUserId, prospecting.assignments],
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
                  ? "Saving…"
                  : saveState === "conflict"
                    ? "Revision conflict - reload the latest version"
                    : saveState === "error"
                      ? "Save failed - use Save draft to retry"
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
          <div ref={formScrollRef}>
            <Form {...form}>
              <ProspectFormSections
                channelOptions={channelOptions}
                profiles={profiles}
                strategies={strategies}
                personasForStrategy={personasForStrategy}
                assignmentIdForStrategy={assignmentIdForStrategy}
                fieldErrors={fieldErrors}
                renderAnnotation={(key) => <DraftAnnotation draft={currentDraft} fieldKey={key} />}
              />
            </Form>
          </div>
        </CardContent>
      </Card>

      <ResearchFields
        draft={currentDraft}
        initialRef={researchInitialRef}
        resetKey={researchResetKey}
        valuesRef={researchRef}
      />

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
      <AlertDialog
        open={qualifyBlockerOpen}
        onOpenChange={(open) => {
          setQualifyBlockerOpen(open);
          if (open) return;
          if (skipQualifyScrollRef.current) {
            skipQualifyScrollRef.current = false;
            return;
          }
          const first = firstQualifyFieldCode(qualifyBlockerIssues);
          if (!first) return;
          window.setTimeout(() => {
            scrollToProspectField(first, formScrollRef.current);
          }, 50);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Qualification not complete</AlertDialogTitle>
            <AlertDialogDescription>{qualifyBlockerMessage}</AlertDialogDescription>
            {qualifyBlockerIssues.length ? (
              <ul className="list-disc space-y-1 pl-4 text-sm text-destructive">
                {qualifyBlockerIssues.map((issue) => (
                  <li key={issue.code}>{issue.message}</li>
                ))}
              </ul>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(busy)}>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(busy)}
              onClick={() => {
                if (busyRef.current) return;
                skipQualifyScrollRef.current = true;
                setQualifyBlockerOpen(false);
                setFieldErrors({});
                busyRef.current = true;
                setBusy("complete");
                void requestCompletion(true)
                  .catch((error) => {
                    if (error instanceof DraftConflictError) {
                      conflictRef.current = true;
                      setSaveState("conflict");
                    }
                    toast.error(error instanceof Error ? error.message : "Could not complete draft.");
                  })
                  .finally(() => {
                    busyRef.current = false;
                    setBusy(null);
                  });
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
