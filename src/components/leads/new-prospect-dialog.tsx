"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Form } from "@/components/ui/form";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { getClientDb } from "@/lib/db/document-access/client";
import { persistLeadGraphClient } from "@/lib/documents/persist-lead-graph-client";
import { persistLeadPatchClient } from "@/lib/documents/persist-lead-patch-client";
import { COLLECTIONS } from "@/lib/documents/collections";
import { doc, getDoc } from "@/lib/db/document-shim/shim-client-firestore";
import { findContactByEmail } from "@/lib/crm-dedupe";
import { fetchCrmDedupeClient } from "@/lib/crm-dedupe-client";
import { isLiveCrmSnapshotDisabled } from "@/lib/dashboard-kpi-v2-flags";
import { fetchCompanyProspectCountForMe } from "@/lib/prospects/fetch-company-prospect-count";
import { fetchExactCompanyProspects } from "@/lib/prospects/fetch-company-prospects";
import { isAuthDisabled } from "@/lib/auth/flags";
import { channelLabelFromValue } from "@/lib/channel-options";
import { useChannelOptions } from "@/hooks/use-channel-options";
import type { NewProspectLaunch } from "@/components/layout/quick-add-launcher";
import { cn } from "@/lib/utils";
import { useProspectingStrategyData } from "@/lib/hooks/use-prospecting-strategy-data";
import { activeAssignmentsForUser } from "@/lib/prospecting-strategy/allocation";
import { countCompanyContactsForUser } from "@/lib/prospecting-strategy/progress";
import type { Lead } from "@/lib/types";
import {
  evaluateQualifyGate,
  collapseAccidentalDoubleName,
  type QualifyIssue,
} from "@/lib/prospecting-strategy/qualify";
import {
  firstQualifyFieldCode,
  issuesToFieldErrors,
  scrollToProspectField,
} from "@/lib/prospecting-strategy/qualify-field-focus";
import { resolveDailyTargets } from "@/lib/prospecting-strategy/types";
import { ProspectFormSections } from "@/components/prospects/prospect-form-sections";
import {
  emptyNewProspectFormDraft,
  mergePrefillIntoDraft,
} from "@/lib/new-prospect-form-draft";
import {
  prospectFormFromDraft,
  type ProspectDraft,
} from "@/lib/prospects/draft-types";
import {
  buildProspectEntities,
  domainFromWebsiteOrEmail,
  isValidOptionalHttpUrl,
  normalizeProspectFormUrlFields,
  normalizedEmail,
  type ProspectFormValues,
} from "@/lib/prospects/prospect-form";

function newEntityId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

function newTimelineEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `te-${crypto.randomUUID()}`;
  }
  return `te-${Date.now()}`;
}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && "formErrors" in error) {
    const formErrors = (error as { formErrors?: string[] }).formErrors?.filter(Boolean) ?? [];
    if (formErrors.length) return formErrors.join(" ");
  }
  return fallback;
}

export function NewProspectDialog({
  open,
  onOpenChange,
  launch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  launch?: NewProspectLaunch;
}) {
  const initialPrefill = launch?.prefill;
  const router = useRouter();
  const {
    currentUserId,
    organizationId,
    getOwnerDisplayName,
    getUserById,
    profiles,
    contacts,
    leads,
    addAccount,
    addContact,
    addLead,
    addTimelineEvent,
    isDemo,
    intentPlaybook,
  } = useWorkspace();
  const channelOptions = useChannelOptions();
  const effectiveUid = currentUserId || undefined;

  const form = useForm<ProspectFormValues>({
    defaultValues: mergePrefillIntoDraft(emptyNewProspectFormDraft(), initialPrefill),
  });

  const [submitting, setSubmitting] = React.useState(false);
  const [draftId, setDraftId] = React.useState(launch?.draftId);
  const [draftSaveState, setDraftSaveState] = React.useState<
    "idle" | "saving" | "saved" | "conflict" | "error"
  >("idle");
  const [lastSavedAt, setLastSavedAt] = React.useState<string>();
  const [ready, setReady] = React.useState(!launch?.draftId);
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [qualifyBlockerOpen, setQualifyBlockerOpen] = React.useState(false);
  const [qualifyBlockerIssues, setQualifyBlockerIssues] = React.useState<QualifyIssue[]>([]);
  const [fieldErrors, setFieldErrors] = React.useState<Partial<Record<string, string>>>({});
  const [loadError, setLoadError] = React.useState<string>();
  const [resumeAttempt, setResumeAttempt] = React.useState(0);
  const skipQualifyScrollRef = React.useRef(false);
  const formScrollRef = React.useRef<HTMLDivElement>(null);
  const draftIdRef = React.useRef<string | undefined>(launch?.draftId);
  const draftRevisionRef = React.useRef<number | undefined>(undefined);
  const saveQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const submittingRef = React.useRef(false);
  const createIdempotencyKeyRef = React.useRef(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `prospect-${Date.now()}`,
  );

  const prospecting = useProspectingStrategyData();
  const myActiveAssignments = React.useMemo(
    () => activeAssignmentsForUser(prospecting.assignments, currentUserId),
    [prospecting.assignments, currentUserId],
  );
  const selectableStrategies = React.useMemo(() => {
    const ids = new Set(myActiveAssignments.map((assignment) => assignment.strategyId));
    const fromAssign = prospecting.strategies.filter(
      (strategy) => ids.has(strategy.id) && strategy.status === "published",
    );
    if (fromAssign.length) return fromAssign;
    return prospecting.strategies.filter(
      (strategy) => strategy.status === "published" || strategy.status === "draft",
    );
  }, [myActiveAssignments, prospecting.strategies]);

  const personasForStrategy = React.useCallback(
    (strategyId: string) => {
      const selected = selectableStrategies.find((strategy) => strategy.id === strategyId);
      if (!selected) return [];
      const assignment = myActiveAssignments.find((item) => item.strategyId === selected.id);
      const personaIds = assignment?.personaIdsOverride?.length
        ? assignment.personaIdsOverride
        : selected.personaIds;
      return prospecting.personas.filter((persona) => personaIds.includes(persona.id) && persona.active);
    },
    [myActiveAssignments, prospecting.personas, selectableStrategies],
  );

  const assignmentIdForStrategy = React.useCallback(
    (strategyId: string) =>
      myActiveAssignments.find((assignment) => assignment.strategyId === strategyId)?.id ?? "",
    [myActiveAssignments],
  );

  const acceptServerDraft = React.useCallback((draft: ProspectDraft) => {
    draftIdRef.current = draft.id;
    draftRevisionRef.current = draft.revision;
    setDraftId(draft.id);
    setLastSavedAt(draft.lastSavedAt);
    setDraftSaveState("saved");
  }, []);

  const readPreparedForm = React.useCallback(
    (source?: ProspectFormValues): ProspectFormValues => {
      const raw = source ?? form.getValues();
      const nextForm = normalizeProspectFormUrlFields({
        ...raw,
        qualifyForm: {
          ...raw.qualifyForm,
          evidence: raw.qualifyForm.evidence.map((row) => ({
            ...row,
            id: row.id || newEntityId("ev"),
          })),
          personalization: { ...raw.qualifyForm.personalization },
        },
      });
      const bizName = collapseAccidentalDoubleName(nextForm.bizName);
      if (bizName !== nextForm.bizName.trim()) nextForm.bizName = bizName;
      if (!nextForm.strategyId) return nextForm;
      return {
        ...nextForm,
        strategyAssignmentId:
          nextForm.strategyAssignmentId || assignmentIdForStrategy(nextForm.strategyId),
        strategyVersion:
          nextForm.strategyVersion ??
          selectableStrategies.find((strategy) => strategy.id === nextForm.strategyId)?.version,
      };
    },
    [assignmentIdForStrategy, form, selectableStrategies],
  );

  const syncPreparedInputs = React.useCallback(
    (nextForm: ProspectFormValues) => {
      const current = form.getValues();
      const keys = ["website", "companyLinkedin", "careersUrl", "linkedin", "bizName"] as const;
      for (const key of keys) {
        if (nextForm[key] !== current[key]) {
          form.setValue(key, nextForm[key], { shouldDirty: true });
        }
      }
      if (nextForm.strategyAssignmentId !== current.strategyAssignmentId) {
        form.setValue("strategyAssignmentId", nextForm.strategyAssignmentId);
      }
      if (nextForm.strategyVersion !== current.strategyVersion) {
        form.setValue("strategyVersion", nextForm.strategyVersion);
      }
    },
    [form],
  );

  const saveServerDraft = React.useCallback(async (snapshot?: ProspectFormValues): Promise<ProspectDraft> => {
    const operation = saveQueueRef.current.catch(() => undefined).then(async () => {
      const nextForm = readPreparedForm(snapshot);
      syncPreparedInputs(nextForm);
      setDraftSaveState("saving");
      let failed: "conflict" | "error" | undefined;
      try {
        const currentId = draftIdRef.current;
        const response = await fetch(
          currentId
            ? `/api/prospect-drafts/${encodeURIComponent(currentId)}`
            : "/api/prospect-drafts",
          {
            method: currentId ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              currentId
                ? {
                    form: nextForm,
                    revision: draftRevisionRef.current,
                  }
                : {
                    form: nextForm,
                    origin: "manual",
                    sourceContext: launch?.source,
                    sourceReference: launch?.sourceReference,
                    destination: launch?.destination,
                    idempotencyKey: createIdempotencyKeyRef.current,
                  },
            ),
          },
        );
        const body = (await response.json()) as {
          draft?: ProspectDraft;
          error?: string | { formErrors?: string[] };
          code?: string;
        };
        if (response.status === 409 || body.code === "revision_conflict") {
          failed = "conflict";
          setDraftSaveState("conflict");
          throw new Error("This draft changed elsewhere. Reload the latest version before saving again.");
        }
        if (!response.ok || !body.draft) {
          failed = "error";
          throw new Error(errorMessage(body.error, "Could not save draft."));
        }
        acceptServerDraft(body.draft);
        return body.draft;
      } catch (error) {
        if (failed !== "conflict") setDraftSaveState("error");
        throw error;
      }
    });
    saveQueueRef.current = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }, [acceptServerDraft, launch, readPreparedForm, syncPreparedInputs]);

  const finalizeClose = React.useCallback(() => {
    setDiscardOpen(false);
    onOpenChange(false);
  }, [onOpenChange]);

  const handleDialogOpenChange = React.useCallback(
    (nextOpen: boolean, eventDetails?: { cancel?: () => void }) => {
      if (nextOpen) {
        onOpenChange(true);
        return;
      }
      eventDetails?.cancel?.();
      if (submittingRef.current) return;
      setDiscardOpen(true);
    },
    [onOpenChange],
  );

  React.useEffect(() => {
    if (!open) return;
    const requestedDraftId = launch?.draftId;
    if (!requestedDraftId) {
      setReady(true);
      setLoadError(undefined);
      return;
    }

    let cancelled = false;
    setReady(false);
    setLoadError(undefined);
    void (async () => {
      try {
        const response = await fetch(
          `/api/prospect-drafts/${encodeURIComponent(requestedDraftId)}`,
          { cache: "no-store" },
        );
        const body = (await response.json()) as { draft?: ProspectDraft; error?: string };
        if (!response.ok || !body.draft) {
          throw new Error(errorMessage(body.error, "Draft not found."));
        }
        if (body.draft.origin !== "manual") {
          throw new Error("Research drafts must be resumed from the draft editor.");
        }
        if (cancelled) return;
        form.reset(prospectFormFromDraft(body.draft));
        draftIdRef.current = body.draft.id;
        draftRevisionRef.current = body.draft.revision;
        setDraftId(body.draft.id);
        setLastSavedAt(body.draft.lastSavedAt);
        setDraftSaveState("saved");
        setReady(true);
      } catch (error) {
        if (cancelled) return;
        draftIdRef.current = undefined;
        draftRevisionRef.current = undefined;
        setDraftId(undefined);
        setDraftSaveState("error");
        setLoadError(error instanceof Error ? error.message : "Could not resume draft.");
        setReady(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, launch?.draftId, form, resumeAttempt]);

  async function createProspect(skipQualifyGate: boolean) {
    if (submittingRef.current) return;
    const oid = effectiveUid?.trim() ?? "";
    if (!oid) {
      toast.error("Sign in to create a prospect.");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
    setFieldErrors({});
    const nextForm = readPreparedForm();
    syncPreparedInputs(nextForm);
    const bn = nextForm.bizName.trim();
    if (!bn) {
      toast.error("Business name is required.");
      return;
    }
    const fn = nextForm.firstName.trim();
    const ln = nextForm.lastName.trim();
    if (!fn || !ln) {
      toast.error("First and last name are required.");
      return;
    }
    const fullName = `${fn} ${ln}`.trim();

    const emailTrim = normalizedEmail(nextForm.email);
    const personalEmailTrim = normalizedEmail(nextForm.personalEmail);
    if (emailTrim && personalEmailTrim && emailTrim === personalEmailTrim) {
      toast.error("Company and personal email must be different.");
      return;
    }
    if (emailTrim) {
      let existing =
        findContactByEmail(contacts, emailTrim) ||
        contacts.find((contact) => normalizedEmail(contact.personalEmail ?? "") === emailTrim);
      if (!existing) {
        const remote = await fetchCrmDedupeClient({ email: emailTrim });
        existing = remote.contact ?? undefined;
      }
      if (existing) {
        toast.error("Contact already exists", {
          description: existing.fullName || `${existing.firstName} ${existing.lastName}`,
          action: {
            label: "View",
            onClick: () => {
              router.push(`/contacts/${existing!.id}`);
              finalizeClose();
            },
          },
        });
        return;
      }
    }
    if (personalEmailTrim) {
      let existing = contacts.find((contact) =>
        [contact.email, contact.personalEmail].some(
          (value) => normalizedEmail(value ?? "") === personalEmailTrim,
        ),
      );
      if (!existing) {
        const remote = await fetchCrmDedupeClient({ email: personalEmailTrim });
        existing = remote.contact ?? undefined;
      }
      if (existing) {
        toast.error("Personal email already belongs to a contact", {
          description: existing.fullName,
        });
        return;
      }
    }

    const urls: [string, string][] = [
      ["Website", nextForm.website],
      ["Company LinkedIn", nextForm.companyLinkedin],
      ["Careers page", nextForm.careersUrl],
      ["Contact LinkedIn", nextForm.linkedin],
    ];
    const invalidUrl = urls.find(([, value]) => !isValidOptionalHttpUrl(value));
    if (invalidUrl) {
      toast.error(`${invalidUrl[0]} must be a valid URL (e.g. example.com or https://example.com).`);
      return;
    }

    const domain = domainFromWebsiteOrEmail(nextForm.website, nextForm.email);
    let companyContactCount = 0;
    if (isLiveCrmSnapshotDisabled(isDemo) && (domain || bn)) {
      try {
        companyContactCount = await fetchCompanyProspectCountForMe(
          domain ? { companyDomain: domain } : { companyName: bn },
        );
      } catch {
        const companyLeads = await fetchExactCompanyProspects(
          domain
            ? { intakeKind: "prospect", companyDomain: domain }
            : { intakeKind: "prospect", companyNameExact: bn },
        );
        companyContactCount = countCompanyContactsForUser(companyLeads, oid, domain, bn);
      }
    } else {
      companyContactCount = countCompanyContactsForUser(leads, oid, domain, bn);
    }
    const selectedStrategy = selectableStrategies.find((strategy) => strategy.id === nextForm.strategyId);
    const maxContacts = resolveDailyTargets(selectedStrategy).maxContactsPerCompany ?? 2;
    const emailIsVerified = nextForm.emailVerify === "verified";
    const qualifyForm = nextForm.qualifyForm;

    let prospectQualifyStatus = qualifyForm.qualifyStatus;
    if (qualifyForm.qualifyStatus === "completed") {
      const gate = evaluateQualifyGate({
        companyName: bn,
        companyWebsite: nextForm.website.trim(),
        contactName: fullName,
        contactTitle: nextForm.title.trim(),
        contactLinkedIn: nextForm.linkedin.trim(),
        emailVerified: emailIsVerified,
        intentEvidence: qualifyForm.evidence,
        personalizationNote: qualifyForm.personalization,
        primaryOpportunityLabel: qualifyForm.primaryOpportunityLabel,
        outreachThreshold: intentPlaybook.outreachThreshold,
        existingContactsForCompany: companyContactCount,
        maxContactsPerCompany: maxContacts,
      });
      if (!gate.ok) {
        if (!skipQualifyGate) {
          const blocking = gate.issues.filter((issue) => issue.blocking);
          setQualifyBlockerIssues(blocking);
          setFieldErrors(issuesToFieldErrors(blocking));
          setQualifyBlockerOpen(true);
          return;
        }
        prospectQualifyStatus = "incomplete";
      }
    }
    if (qualifyForm.qualifyStatus === "rejected" && !qualifyForm.rejectionReason) {
      toast.error("Select a rejection reason.");
      return;
    }

    const yearFounded = nextForm.yearFounded.trim();
    if (yearFounded) {
      const year = Number(yearFounded);
      if (!Number.isFinite(year) || year < 1800 || year > new Date().getFullYear() + 1) {
        toast.error("Year founded should be a valid year.");
        return;
      }
    }
    if (nextForm.lastSiteAt && new Date(`${nextForm.lastSiteAt}T12:00:00`).getTime() > Date.now()) {
      toast.error("Last website activity cannot be in the future.");
      return;
    }

    if (!isDemo && !isAuthDisabled()) {
      try {
        const savedDraft = await saveServerDraft(nextForm);
        const response = await fetch(
          `/api/prospect-drafts/${encodeURIComponent(savedDraft.id)}/complete`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              allowIncomplete: skipQualifyGate,
              revision: savedDraft.revision,
            }),
          },
        );
        const body = (await response.json()) as {
          leadId?: string;
          error?: string;
          code?: string;
        };
        if (response.status === 409 || body.code === "revision_conflict") {
          setDraftSaveState("conflict");
          throw new Error("This draft changed elsewhere. Reload the latest version before creating the prospect.");
        }
        if (!response.ok || !body.leadId) {
          throw new Error(body.error ?? "Could not create prospect.");
        }
        toast.success(
          skipQualifyGate
            ? "Prospect created as incomplete."
            : "Prospect created from your saved draft.",
        );
        onOpenChange(false);
        router.push(`/leads/${body.leadId}?from=prospects`);
      } catch (error) {
        toast.error("Could not save prospect", {
          description: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    const now = new Date().toISOString();
    const accountId = newEntityId("a");
    const contactId = newEntityId("ct");
    const leadId = newEntityId("l");
    const strategyId = nextForm.strategyId;
    const resolvedAssignmentId = strategyId
      ? nextForm.strategyAssignmentId || assignmentIdForStrategy(strategyId)
      : "";
    const resolvedVersion = strategyId
      ? (nextForm.strategyVersion ?? selectedStrategy?.version)
      : undefined;

    const entitiesForm: ProspectFormValues = {
      ...nextForm,
      strategyAssignmentId: resolvedAssignmentId,
      strategyVersion: resolvedVersion,
      qualifyForm: {
        ...qualifyForm,
        qualifyStatus: prospectQualifyStatus,
      },
    };

    const { account, contact, lead } = buildProspectEntities({
      form: entitiesForm,
      accountId,
      contactId,
      leadId,
      ownerId: oid,
      now,
      qualifyAsIncomplete: skipQualifyGate && prospectQualifyStatus === "incomplete",
    });

    account.contactCount = 0;

    const creatorLabel =
      getOwnerDisplayName(oid)?.trim() ||
      getUserById(oid)?.displayName?.trim() ||
      "Teammate";

    try {
      if (!isDemo && organizationId) {
        const db = getClientDb();
        await persistLeadGraphClient(db, organizationId, account, contact, lead);
        const saved = await getDoc(doc(db, COLLECTIONS.leads, leadId));
        if (saved.exists()) {
          const data = saved.data();
          const needsRepair =
            data.intakeKind !== "prospect" || data.prospectVisibility !== "open";
          if (needsRepair) {
            await persistLeadPatchClient(db, leadId, {
              intakeKind: "prospect",
              prospectVisibility: "open",
              prospectOwnerId: oid,
            });
          }
        }
      } else {
        await addAccount(account);
        await addContact(contact);
        await addLead(lead);
      }
      addTimelineEvent({
        id: newTimelineEventId(),
        leadId,
        type: "lead_created",
        actorId: oid,
        summary: `Prospect created by ${creatorLabel} for ${channelLabelFromValue(nextForm.channel, channelOptions) || nextForm.channel}. Add channel assignments when ready.`,
        createdAt: now,
      });
      toast.success(
        prospectQualifyStatus === "incomplete" && qualifyForm.qualifyStatus === "completed"
          ? "Prospect created as incomplete - finish qualification on the record when ready."
          : "Prospect created - add channels when ready.",
      );
      onOpenChange(false);
      router.push(`/leads/${leadId}?from=prospects`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Could not save prospect", { description: msg });
    }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (draftSaveState === "conflict") return;
    await createProspect(false);
  }

  async function handleSaveDraft(closeAfterSave = false) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await saveServerDraft();
      toast.success(closeAfterSave ? "Draft saved" : "Draft saved for later");
      if (closeAfterSave) {
        onOpenChange(false);
        if (launch?.destination) router.push(launch.destination);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save draft.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function reloadLatestDraft() {
    const currentId = draftIdRef.current;
    if (!currentId || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/prospect-drafts/${encodeURIComponent(currentId)}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as { draft?: ProspectDraft; error?: string };
      if (!response.ok || !body.draft) {
        throw new Error(errorMessage(body.error, "Could not reload draft."));
      }
      form.reset(prospectFormFromDraft(body.draft));
      setFieldErrors({});
      acceptServerDraft(body.draft);
      toast.success("Latest draft loaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reload draft.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const saveStateLabel = loadError
    ? "Could not load this draft"
    : draftSaveState === "saving"
      ? "Saving…"
      : draftSaveState === "saved"
        ? `Saved${lastSavedAt ? ` ${new Date(lastSavedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`
        : draftSaveState === "conflict"
          ? "Revision conflict - reload the latest version"
          : draftSaveState === "error"
            ? "Save failed - use Save draft to retry"
            : draftId
              ? "Draft ready"
              : "Not saved yet";

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          className="flex flex-col min-h-0 sm:max-w-3xl w-[calc(100vw-1.5rem)] max-h-[min(92vh,880px)] overflow-hidden gap-0 p-0"
          showCloseButton
        >
          <Form {...form}>
            <form
              onSubmit={(event) => void handleSubmit(event)}
              className="flex min-h-0 flex-1 flex-col"
            >
              <DialogHeader className="px-6 pt-6 pb-3 shrink-0 border-b">
                <DialogTitle>New prospect</DialogTitle>
                <DialogDescription>
                  Add the essentials now. Company research can be completed later from the prospect
                  record.
                </DialogDescription>
                <p
                  className={cn(
                    "text-xs",
                    draftSaveState === "conflict" || draftSaveState === "error"
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                  role="status"
                  aria-live="polite"
                >
                  {saveStateLabel}
                </p>
              </DialogHeader>

              <div
                ref={formScrollRef}
                className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-6"
              >
                {!ready ? (
                  <div className="space-y-3">
                    <p className={loadError ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
                      {loadError ?? "Loading draft…"}
                    </p>
                    {loadError ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setResumeAttempt((attempt) => attempt + 1)}
                      >
                        Retry
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <fieldset disabled={submitting} className="m-0 min-w-0 border-0 p-0">
                    <ProspectFormSections
                      channelOptions={channelOptions}
                      profiles={profiles}
                      strategies={selectableStrategies}
                      personasForStrategy={personasForStrategy}
                      assignmentIdForStrategy={assignmentIdForStrategy}
                      fieldErrors={fieldErrors}
                    />
                  </fieldset>
                )}
              </div>

              <DialogFooter className="px-6 py-4 border-t shrink-0 bg-muted/20">
                <Button type="button" variant="outline" onClick={() => setDiscardOpen(true)} disabled={submitting}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleSaveDraft(false)}
                  disabled={submitting || !ready || draftSaveState === "conflict"}
                >
                  {draftSaveState === "saving" ? "Saving…" : "Save draft"}
                </Button>
                {draftSaveState === "conflict" ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void reloadLatestDraft()}
                    disabled={submitting}
                  >
                    Reload latest
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void handleSaveDraft(true)}
                  disabled={submitting || !ready || draftSaveState === "conflict"}
                >
                  Save & close
                </Button>
                <Button type="submit" disabled={submitting || !ready || draftSaveState === "conflict"}>
                  {submitting ? "Saving…" : "Create prospect"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={qualifyBlockerOpen}
        onOpenChange={(nextOpen) => {
          setQualifyBlockerOpen(nextOpen);
          if (nextOpen) return;
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
            <AlertDialogDescription>
              This prospect does not meet your completed qualification rules yet. You can go back
              and add evidence, or create it anyway as an incomplete draft.
            </AlertDialogDescription>
            {qualifyBlockerIssues.length ? (
              <ul className="list-disc space-y-1 pl-4 text-sm text-destructive">
                {qualifyBlockerIssues.map((issue) => (
                  <li key={issue.code}>{issue.message}</li>
                ))}
              </ul>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={() => {
                skipQualifyScrollRef.current = true;
                setQualifyBlockerOpen(false);
                setFieldErrors({});
                void createProspect(true);
              }}
            >
              Create prospect anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close this form?</AlertDialogTitle>
            <AlertDialogDescription>
              Unsaved changes will be lost. A previously saved draft stays available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={finalizeClose}>Close without saving</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
