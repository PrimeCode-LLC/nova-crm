"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
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
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { getClientDb } from "@/lib/db/document-access/client";
import { persistLeadGraphClient } from "@/lib/documents/persist-lead-graph-client";
import { persistLeadPatchClient } from "@/lib/documents/persist-lead-patch-client";
import { COLLECTIONS } from "@/lib/documents/collections";
import { doc, getDoc } from "@/lib/db/document-shim/shim-client-firestore";
import { findContactByEmail } from "@/lib/crm-dedupe";
import { isAuthDisabled } from "@/lib/auth/flags";
import { channelLabelFromValue } from "@/lib/channel-options";
import { useChannelOptions } from "@/hooks/use-channel-options";
import type { NewProspectLaunch } from "@/components/layout/quick-add-launcher";
import { cn } from "@/lib/utils";
import { useProspectingStrategyData } from "@/lib/hooks/use-prospecting-strategy-data";
import { activeAssignmentsForUser } from "@/lib/prospecting-strategy/allocation";
import { countCompanyContactsForUser } from "@/lib/prospecting-strategy/progress";
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
  acknowledgeLegacyDraftMigration,
  clearNewProspectDraft,
  emptyNewProspectFormDraft,
  isNewProspectFormDraftEmpty,
  loadNewProspectDraft,
  mergePrefillIntoDraft,
  PENDING_PROSPECT_DRAFT_ID,
  pendingProspectDraftId,
  saveNewProspectDraft,
  serializeNewProspectDraft,
  type NewProspectFormDraft,
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
} from "@/lib/prospects/prospect-form";

const AUTOSAVE_MS = 800;

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

function emptyBaseline(): string {
  return serializeNewProspectDraft(emptyNewProspectFormDraft());
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
  const pendingRecoveryId = React.useMemo(() => pendingProspectDraftId(launch), [launch]);
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
  /** Prefer workspace uid for drafts and ownership (Clerk + Postgres). */
  const effectiveUid = currentUserId || undefined;

  const [form, setForm] = React.useState<NewProspectFormDraft>(() =>
    mergePrefillIntoDraft(emptyNewProspectFormDraft(), initialPrefill),
  );
  const formRef = React.useRef(form);
  formRef.current = form;

  const [submitting, setSubmitting] = React.useState(false);
  const [draftId, setDraftId] = React.useState(launch?.draftId);
  const [draftSaveState, setDraftSaveState] = React.useState<
    "idle" | "saving" | "saved" | "offline" | "conflict" | "error"
  >("idle");
  const [lastSavedAt, setLastSavedAt] = React.useState<string>();
  const [draftInitialized, setDraftInitialized] = React.useState(false);
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [qualifyBlockerOpen, setQualifyBlockerOpen] = React.useState(false);
  const [qualifyBlockerIssues, setQualifyBlockerIssues] = React.useState<QualifyIssue[]>([]);
  const [fieldErrors, setFieldErrors] = React.useState<Partial<Record<string, string>>>({});
  const skipQualifyScrollRef = React.useRef(false);
  const formScrollRef = React.useRef<HTMLDivElement>(null);
  const [baselineSerialized, setBaselineSerialized] = React.useState(emptyBaseline);
  const wasOpenRef = React.useRef(false);
  const restoredToastShownRef = React.useRef(false);
  const draftIdRef = React.useRef<string | undefined>(launch?.draftId);
  const draftRevisionRef = React.useRef<number | undefined>(undefined);
  const saveQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const createIdempotencyKeyRef = React.useRef(crypto.randomUUID());

  const prospecting = useProspectingStrategyData();
  const myActiveAssignments = React.useMemo(
    () => activeAssignmentsForUser(prospecting.assignments, currentUserId),
    [prospecting.assignments, currentUserId],
  );
  const selectableStrategies = React.useMemo(() => {
    const ids = new Set(myActiveAssignments.map((a) => a.strategyId));
    const fromAssign = prospecting.strategies.filter(
      (s) => ids.has(s.id) && s.status === "published",
    );
    if (fromAssign.length) return fromAssign;
    return prospecting.strategies.filter((s) => s.status === "published" || s.status === "draft");
  }, [myActiveAssignments, prospecting.strategies]);
  const selectedStrategy = React.useMemo(
    () => selectableStrategies.find((s) => s.id === form.strategyId),
    [selectableStrategies, form.strategyId],
  );
  const strategyPersonas = React.useMemo(() => {
    if (!selectedStrategy) return [];
    const assignment = myActiveAssignments.find((a) => a.strategyId === selectedStrategy.id);
    const pids = assignment?.personaIdsOverride?.length
      ? assignment.personaIdsOverride
      : selectedStrategy.personaIds;
    return prospecting.personas.filter((p) => pids.includes(p.id) && p.active);
  }, [selectedStrategy, myActiveAssignments, prospecting.personas]);

  const maxContacts = resolveDailyTargets(selectedStrategy).maxContactsPerCompany ?? 2;

  const companyDomain = React.useMemo(
    () => domainFromWebsiteOrEmail(form.website, form.email),
    [form.website, form.email],
  );
  const existingContactsForCompany = React.useMemo(
    () => countCompanyContactsForUser(leads, currentUserId, companyDomain, form.bizName),
    [leads, currentUserId, companyDomain, form.bizName],
  );

  const formSerialized = React.useMemo(() => serializeNewProspectDraft(form), [form]);
  const isDirty = formSerialized !== baselineSerialized;

  const applyDraft = React.useCallback((draft: NewProspectFormDraft) => {
    setForm(draft);
  }, []);

  const handleFormChange = React.useCallback((next: NewProspectFormDraft) => {
    setForm(next);
    setFieldErrors((prev) => {
      if (!Object.keys(prev).length) return prev;
      const fullName = collapseAccidentalDoubleName(
        `${next.firstName} ${next.lastName}`.trim(),
      );
      const gate = evaluateQualifyGate({
        companyName: next.bizName.trim(),
        companyWebsite: next.website.trim(),
        contactName: fullName,
        contactTitle: next.title.trim(),
        contactLinkedIn: next.linkedin.trim(),
        emailVerified: next.emailVerify === "verified",
        intentEvidence: next.qualifyForm.evidence,
        personalizationNote: next.qualifyForm.personalization,
        primaryOpportunityLabel: next.qualifyForm.primaryOpportunityLabel,
        outreachThreshold: intentPlaybook.outreachThreshold,
        existingContactsForCompany: countCompanyContactsForUser(
          leads,
          currentUserId,
          domainFromWebsiteOrEmail(next.website, next.email),
          next.bizName,
        ),
        maxContactsPerCompany: maxContacts,
      });
      const stillBlocking = issuesToFieldErrors(gate.issues);
      const nextErrors: Partial<Record<string, string>> = {};
      for (const code of Object.keys(prev)) {
        if (stillBlocking[code]) nextErrors[code] = stillBlocking[code];
      }
      return nextErrors;
    });
  }, [
    currentUserId,
    intentPlaybook.outreachThreshold,
    leads,
    maxContacts,
  ]);

  const resetForm = React.useCallback(() => {
    setForm(emptyNewProspectFormDraft());
    setFieldErrors({});
    setQualifyBlockerIssues([]);
  }, []);

  const syncBaseline = React.useCallback(() => {
    setBaselineSerialized(serializeNewProspectDraft(formRef.current));
  }, []);

  const acceptServerDraft = React.useCallback(
    (draft: ProspectDraft, nextForm: NewProspectFormDraft) => {
      draftIdRef.current = draft.id;
      draftRevisionRef.current = draft.revision;
      setDraftId(draft.id);
      setLastSavedAt(draft.lastSavedAt);
      setBaselineSerialized(serializeNewProspectDraft(nextForm));
      setDraftSaveState("saved");
      acknowledgeLegacyDraftMigration(effectiveUid, draft.id, nextForm, draft.revision);
    },
    [effectiveUid],
  );

  const saveServerDraft = React.useCallback(async (): Promise<ProspectDraft> => {
    const operation = saveQueueRef.current.catch(() => undefined).then(async () => {
      const nextForm = formRef.current;
      saveNewProspectDraft(
        effectiveUid,
        draftIdRef.current ?? pendingRecoveryId,
        nextForm,
        draftRevisionRef.current,
      );
      setDraftSaveState("saving");
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
          setDraftSaveState("conflict");
          throw new Error("This draft changed elsewhere. Reopen it to load the latest version.");
        }
        if (!response.ok || !body.draft) {
          throw new Error(
            typeof body.error === "string" ? body.error : "Could not save draft.",
          );
        }
        acceptServerDraft(body.draft, nextForm);
        return body.draft;
      } catch (error) {
        setDraftSaveState((state) =>
          state === "conflict"
            ? state
            : typeof navigator !== "undefined" && !navigator.onLine
              ? "offline"
              : error instanceof TypeError
                ? "offline"
                : "error",
        );
        throw error;
      }
    });
    saveQueueRef.current = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }, [acceptServerDraft, effectiveUid, launch, pendingRecoveryId]);

  const finalizeClose = React.useCallback(
    (options?: { discard?: boolean }) => {
      if (options?.discard) {
        resetForm();
        if (draftIdRef.current) clearNewProspectDraft(effectiveUid, draftIdRef.current);
        clearNewProspectDraft(effectiveUid, pendingRecoveryId);
        clearNewProspectDraft(effectiveUid, PENDING_PROSPECT_DRAFT_ID);
        clearNewProspectDraft(effectiveUid);
        syncBaseline();
      } else if (!isDirty) {
        clearNewProspectDraft(effectiveUid);
      }
      setDiscardOpen(false);
      onOpenChange(false);
    },
    [effectiveUid, isDirty, onOpenChange, pendingRecoveryId, resetForm, syncBaseline],
  );

  const requestClose = React.useCallback(() => {
    if (isDirty) {
      setDiscardOpen(true);
      return;
    }
    finalizeClose();
  }, [finalizeClose, isDirty]);

  const handleDialogOpenChange = React.useCallback(
    (nextOpen: boolean, eventDetails?: { cancel?: () => void }) => {
      if (nextOpen) {
        onOpenChange(true);
        return;
      }
      if (isDirty) {
        eventDetails?.cancel?.();
        setDiscardOpen(true);
        return;
      }
      finalizeClose();
    },
    [finalizeClose, isDirty, onOpenChange],
  );

  React.useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      restoredToastShownRef.current = false;
      return;
    }

    const justOpened = !wasOpenRef.current;
    wasOpenRef.current = true;
    if (!justOpened) return;

    let cancelled = false;
    void (async () => {
      const requestedDraftId = launch?.draftId;
      if (requestedDraftId) {
        try {
          const response = await fetch(
            `/api/prospect-drafts/${encodeURIComponent(requestedDraftId)}`,
            { cache: "no-store" },
          );
          const body = (await response.json()) as { draft?: ProspectDraft; error?: string };
          if (!response.ok || !body.draft) {
            throw new Error(body.error ?? "Draft not found.");
          }
          if (body.draft.origin !== "manual") {
            throw new Error("Research drafts must be resumed from the draft editor.");
          }
          const serverForm = prospectFormFromDraft(body.draft);
          const local = loadNewProspectDraft(effectiveUid, requestedDraftId);
          const hasNewerLocal =
            local &&
            serializeNewProspectDraft(local.form) !== serializeNewProspectDraft(serverForm) &&
            Date.parse(local.savedAt || "1970-01-01") > Date.parse(body.draft.lastSavedAt);
          if (cancelled) return;
          applyDraft(hasNewerLocal ? local.form : serverForm);
          draftIdRef.current = body.draft.id;
          draftRevisionRef.current = body.draft.revision;
          setDraftId(body.draft.id);
          setLastSavedAt(body.draft.lastSavedAt);
          setBaselineSerialized(serializeNewProspectDraft(serverForm));
          setDraftSaveState(hasNewerLocal ? "offline" : "saved");
          if (hasNewerLocal) toast.message("Recovered newer changes saved on this device.");
        } catch (error) {
          if (!cancelled) {
            const local = loadNewProspectDraft(effectiveUid, requestedDraftId);
            if (local) {
              applyDraft(local.form);
              draftIdRef.current = requestedDraftId;
              draftRevisionRef.current = local.revision;
              setDraftId(requestedDraftId);
              setBaselineSerialized(emptyBaseline());
            }
            setDraftSaveState("offline");
            toast.error(
              local
                ? "Server unavailable. Recovered the copy saved on this device."
                : error instanceof Error
                  ? error.message
                  : "Could not resume draft.",
            );
          }
        } finally {
          if (!cancelled) setDraftInitialized(true);
        }
        return;
      }

      const pending =
        loadNewProspectDraft(effectiveUid, pendingRecoveryId) ??
        (!initialPrefill
          ? loadNewProspectDraft(effectiveUid, PENDING_PROSPECT_DRAFT_ID)
          : null);
      const legacy = loadNewProspectDraft(effectiveUid);
      const recovered = pending?.form ?? legacy?.form;
      const next =
        recovered && !isNewProspectFormDraftEmpty(recovered)
          ? recovered
          : mergePrefillIntoDraft(emptyNewProspectFormDraft(), initialPrefill);
      if (cancelled) return;
      applyDraft(next);
      setBaselineSerialized(emptyBaseline());
      setDraftSaveState(recovered ? "offline" : "idle");
      setDraftInitialized(true);
      if (recovered && !restoredToastShownRef.current) {
        restoredToastShownRef.current = true;
        toast.message("Restored your unsaved prospect draft.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    effectiveUid,
    applyDraft,
    initialPrefill,
    launch?.draftId,
    pendingRecoveryId,
  ]);

  // Debounced local + server autosave (avoids sync localStorage on every keystroke).
  React.useEffect(() => {
    if (!open || !draftInitialized || !isDirty || submitting) return;
    const handle = window.setTimeout(() => {
      saveNewProspectDraft(
        effectiveUid,
        draftIdRef.current ?? pendingRecoveryId,
        formRef.current,
        draftRevisionRef.current,
      );
      void saveServerDraft().catch(() => undefined);
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(handle);
  }, [
    open,
    draftInitialized,
    isDirty,
    submitting,
    effectiveUid,
    pendingRecoveryId,
    formSerialized,
    saveServerDraft,
  ]);

  // Flush local recovery on unmount / close so a mid-debounce close does not lose work.
  React.useEffect(() => {
    if (!open || !draftInitialized) return;
    return () => {
      if (!isDirty) return;
      saveNewProspectDraft(
        effectiveUid,
        draftIdRef.current ?? pendingRecoveryId,
        formRef.current,
        draftRevisionRef.current,
      );
    };
  }, [open, draftInitialized, isDirty, effectiveUid, pendingRecoveryId]);

  async function createProspect(skipQualifyGate: boolean) {
    const oid = effectiveUid?.trim() ?? "";
    if (!oid) {
      toast.error("Sign in to create a prospect.");
      return;
    }

    const nextForm = normalizeProspectFormUrlFields({ ...formRef.current });
    const bn = collapseAccidentalDoubleName(nextForm.bizName);
    if (bn !== nextForm.bizName.trim()) {
      nextForm.bizName = bn;
    }
    if (
      nextForm.website !== formRef.current.website ||
      nextForm.companyLinkedin !== formRef.current.companyLinkedin ||
      nextForm.careersUrl !== formRef.current.careersUrl ||
      nextForm.linkedin !== formRef.current.linkedin ||
      bn !== formRef.current.bizName.trim()
    ) {
      setForm(nextForm);
    }
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
      const existing =
        findContactByEmail(contacts, emailTrim) ||
        contacts.find((c) => normalizedEmail(c.personalEmail ?? "") === emailTrim);
      if (existing) {
        toast.error("Contact already exists", {
          description: existing.fullName || `${existing.firstName} ${existing.lastName}`,
          action: {
            label: "View",
            onClick: () => {
              router.push(`/contacts/${existing.id}`);
              requestClose();
            },
          },
        });
        return;
      }
    }
    if (personalEmailTrim) {
      const existing = contacts.find((c) =>
        [c.email, c.personalEmail].some((value) => normalizedEmail(value ?? "") === personalEmailTrim),
      );
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
    const companyContactCount = countCompanyContactsForUser(leads, oid, domain, bn);
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
          const blocking = gate.issues.filter((i) => i.blocking);
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

    const yf = nextForm.yearFounded.trim();
    if (yf) {
      const n = Number(yf);
      if (!Number.isFinite(n) || n < 1800 || n > new Date().getFullYear() + 1) {
        toast.error("Year founded should be a valid year.");
        return;
      }
    }
    if (nextForm.lastSiteAt && new Date(`${nextForm.lastSiteAt}T12:00:00`).getTime() > Date.now()) {
      toast.error("Last website activity cannot be in the future.");
      return;
    }

    formRef.current = nextForm;

    if (!isDemo && !isAuthDisabled()) {
      setSubmitting(true);
      try {
        const savedDraft = await saveServerDraft();
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
          throw new Error("This draft changed elsewhere. Reopen it before creating the prospect.");
        }
        if (!response.ok || !body.leadId) {
          throw new Error(body.error ?? "Could not create prospect.");
        }
        clearNewProspectDraft(effectiveUid, savedDraft.id);
        clearNewProspectDraft(effectiveUid, pendingRecoveryId);
        clearNewProspectDraft(effectiveUid, PENDING_PROSPECT_DRAFT_ID);
        clearNewProspectDraft(effectiveUid);
        toast.success(
          skipQualifyGate
            ? "Prospect created as incomplete."
            : "Prospect created from your saved draft.",
        );
        resetForm();
        onOpenChange(false);
        router.push(`/leads/${body.leadId}?from=prospects`);
      } catch (error) {
        toast.error("Could not save prospect", {
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const now = new Date().toISOString();
    const accountId = newEntityId("a");
    const contactId = newEntityId("ct");
    const leadId = newEntityId("l");
    const strategyId = nextForm.strategyId;
    const resolvedAssignmentId = strategyId
      ? nextForm.strategyAssignmentId ||
        myActiveAssignments.find((a) => a.strategyId === strategyId)?.id ||
        ""
      : "";
    const resolvedVersion = strategyId
      ? (nextForm.strategyVersion ?? selectedStrategy?.version)
      : undefined;

    const entitiesForm: NewProspectFormDraft = {
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

    // Preserve previous demo/local contactCount behavior (graph starts empty).
    account.contactCount = 0;

    const createdById = oid;
    const creatorLabel =
      getOwnerDisplayName(oid)?.trim() ||
      getUserById(oid)?.displayName?.trim() ||
      "Teammate";

    setSubmitting(true);
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
        actorId: createdById,
        summary: `Prospect created by ${creatorLabel} for ${channelLabelFromValue(nextForm.channel, channelOptions) || nextForm.channel}. Add channel assignments when ready.`,
        createdAt: now,
      });
      toast.success(
        prospectQualifyStatus === "incomplete" && qualifyForm.qualifyStatus === "completed"
          ? "Prospect created as incomplete - finish qualification on the record when ready."
          : "Prospect created - add channels when ready.",
      );
      resetForm();
      if (draftIdRef.current) clearNewProspectDraft(effectiveUid, draftIdRef.current);
      clearNewProspectDraft(effectiveUid, pendingRecoveryId);
      clearNewProspectDraft(effectiveUid, PENDING_PROSPECT_DRAFT_ID);
      clearNewProspectDraft(effectiveUid);
      onOpenChange(false);
      router.push(`/leads/${leadId}?from=prospects`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Could not save prospect", { description: msg });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await createProspect(false);
  }

  async function handleSaveDraft(closeAfterSave = false) {
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
      setSubmitting(false);
    }
  }

  async function reloadLatestDraft() {
    const currentId = draftIdRef.current;
    if (!currentId) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/prospect-drafts/${encodeURIComponent(currentId)}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as { draft?: ProspectDraft; error?: string };
      if (!response.ok || !body.draft) {
        throw new Error(body.error ?? "Could not reload draft.");
      }
      const nextForm = prospectFormFromDraft(body.draft);
      applyDraft(nextForm);
      acceptServerDraft(body.draft, nextForm);
      toast.success("Latest draft loaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reload draft.");
    } finally {
      setSubmitting(false);
    }
  }

  const saveStateLabel =
    draftSaveState === "saving"
      ? "Saving…"
      : draftSaveState === "saved"
        ? `Saved${lastSavedAt ? ` ${new Date(lastSavedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`
        : draftSaveState === "offline"
          ? "Offline recovery saved on this device"
          : draftSaveState === "conflict"
            ? "Revision conflict - reload the latest version"
            : draftSaveState === "error"
              ? "Autosave failed - use Save draft to retry"
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
          <form
            onSubmit={(e) => void handleSubmit(e)}
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
                    : draftSaveState === "offline"
                      ? "text-amber-600 dark:text-amber-400"
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
              <ProspectFormSections
                values={form}
                onChange={handleFormChange}
                channelOptions={channelOptions}
                profiles={profiles}
                strategies={selectableStrategies}
                personas={strategyPersonas}
                outreachThreshold={intentPlaybook.outreachThreshold}
                existingContactsForCompany={existingContactsForCompany}
                maxContactsPerCompany={maxContacts}
                fieldErrors={fieldErrors}
              />
            </div>

            <DialogFooter className="px-6 py-4 border-t shrink-0 bg-muted/20">
              <Button type="button" variant="outline" onClick={requestClose} disabled={submitting}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleSaveDraft(false)}
                disabled={submitting || !draftInitialized || draftSaveState === "conflict"}
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
                disabled={submitting || !draftInitialized || draftSaveState === "conflict"}
              >
                Save & close
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving…" : "Create prospect"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
          // Wait for the alert to unmount so the form scroll container can move.
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
            <AlertDialogTitle>Close without saving the latest changes?</AlertDialogTitle>
            <AlertDialogDescription>
              The last server-saved version will remain available. Changes made since then will be
              removed from this device.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => finalizeClose({ discard: true })}>
              Close without saving
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
