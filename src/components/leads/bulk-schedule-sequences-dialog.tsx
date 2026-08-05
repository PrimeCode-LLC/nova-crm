"use client";

import * as React from "react";
import { CalendarClock, CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import {
  getActiveMailbox,
  isEmailAccountConfigured,
  useEmailAccountStore,
} from "@/stores/email-account-store";
import type { EmailMailboxSettings } from "@/lib/email-account-types";
import {
  assignProspectSchedule,
  loadMailboxCapacityStates,
  type MailboxCapacityState,
} from "@/lib/email/bulk-mailbox-assign";
import {
  buildContactRecipientOptions,
  defaultContactRecipientEmail,
} from "@/lib/email/contact-recipient-options";
import {
  loadLastUsedMailboxPrefs,
  rememberLastUsedMailboxPool,
  resolveDefaultScheduleMailboxPool,
} from "@/lib/email/last-used-mailbox-prefs";
import {
  buildOwnerMailboxMatchGroups,
  filterMailboxesSharedWithLeadOwner,
  ownerSharedMailboxSkipReason,
} from "@/lib/email/owner-shared-mailbox";
import { hydrateFollowupMessageBody } from "@/lib/firestore/fetch-followup-message-body-client";
import {
  canAutoScheduleFollowupEmail,
  getActiveFollowupPlanForLead,
  openFollowupsForPlan,
  resolveFollowupChannel,
} from "@/lib/followup-plans";
import {
  countContinuityPreflight,
  resolvePriorSequenceSender,
  type SequenceScheduleContinuityMode,
} from "@/lib/email/sequence-schedule-continuity";
import {
  scheduleFollowupEmailClient,
} from "@/lib/schedule-followup-email-client";
import {
  formatInstantInZone,
  isoFromDatetimeLocalInZone,
  todayDateInputInZone,
} from "@/lib/org-timezone";
import { useOrgTimezone } from "@/hooks/use-org-timezone";
import {
  defaultAudienceScheduleDatetimeLocal,
  resolveLeadSendWindow,
} from "@/lib/email/audience-schedule";
import {
  formatScheduleDayLabel,
  scheduleDayKeyFromDate,
} from "@/lib/email/mailbox-schedule-capacity";
import {
  isBulkScheduleStartInFuture,
  resolveBulkScheduleStartIso,
  shiftSequenceStepsToStart,
  type BulkScheduleStartPreset,
  type BulkScheduleTimingMode,
} from "@/lib/email/bulk-schedule-timing";
import { defaultCustomDueInputs } from "@/lib/followup-due-display";
import { useProspectingStrategyData } from "@/lib/hooks/use-prospecting-strategy-data";
import { MailboxSignaturePreview } from "@/components/leads/mailbox-signature-preview";
import { GlobalEmailFooterPreview } from "@/components/leads/global-email-footer-preview";
import { cn } from "@/lib/utils";
import type { Followup } from "@/lib/types";

function toScheduleIso(value: string, wallClockZone: string): string {
  const trimmed = value.trim();
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? isoFromDatetimeLocalInZone(trimmed, wallClockZone) : d.toISOString();
  }
  return isoFromDatetimeLocalInZone(trimmed, wallClockZone);
}

type RowStatus = "pending" | "running" | "success" | "skipped" | "failed";

type LeadRow = {
  leadId: string;
  label: string;
  status: RowStatus;
  detail?: string;
};

type PreflightBucket = "ready" | "already_scheduled" | "skipped";

function mailboxOptionLabel(mb: EmailMailboxSettings): string {
  const label = mb.label?.trim();
  const email = mb.emailAddress?.trim();
  if (label && email) return `${label} · ${email}`;
  if (email) return email;
  if (label) return label;
  const name = mb.displayName?.trim();
  if (name) return name;
  return "Mailbox";
}

const START_PRESETS: { id: BulkScheduleStartPreset; label: string }[] = [
  { id: "tomorrow9", label: "Tomorrow 9 AM" },
  { id: "nextMonday9", label: "Next Monday 9 AM" },
  { id: "custom", label: "Pick date & time…" },
];

function leadLabel(lead: { contactName?: string; companyName?: string; id: string }): string {
  const name = lead.contactName?.trim();
  const company = lead.companyName?.trim();
  if (name && company) return `${name} · ${company}`;
  return name || company || lead.id;
}

export function BulkScheduleSequencesDialog({
  open,
  onOpenChange,
  leadIds,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  onComplete?: () => void;
}) {
  const {
    isDemo,
    leads,
    followups,
    followupPlans,
    getContactById,
    setFollowupEmailSchedule,
    updateFollowup,
    currentUserId,
    organizationId,
    getOwnerDisplayName,
    organizationSendPolicy,
  } = useWorkspace();
  const timeZone = useOrgTimezone();
  const prospecting = useProspectingStrategyData();

  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const activeMailboxId = useEmailAccountStore((s) => s.activeMailboxId);
  const addScheduled = useEmailAccountStore((s) => s.addScheduled);
  const scheduled = useEmailAccountStore((s) => s.scheduled);
  const globalEmailFooter = useEmailAccountStore((s) => s.globalEmailFooter);

  const sendableMailboxes = React.useMemo(() => {
    const list = mailboxes.length > 0 ? mailboxes : [getActiveMailbox({ mailboxes, activeMailboxId })];
    if (isDemo) return list;
    return list.filter((mb) => isEmailAccountConfigured(mb));
  }, [mailboxes, activeMailboxId, isDemo]);

  const [phase, setPhase] = React.useState<"setup" | "preview" | "running" | "done">("setup");
  const [previewByDay, setPreviewByDay] = React.useState<{ day: string; count: number }[]>([]);
  const [previewByMailbox, setPreviewByMailbox] = React.useState<
    { mailboxId: string; label: string; count: number }[]
  >([]);
  const [previewReady, setPreviewReady] = React.useState(false);
  const previewPlansRef = React.useRef<
    {
      leadId: string;
      mailboxId: string;
      steps: { id: string; scheduledAt: string; included: boolean }[];
      startFresh: boolean;
    }[]
  >([]);
  const [selectedMailboxIds, setSelectedMailboxIds] = React.useState<string[]>([]);
  const [preferOwnerShared, setPreferOwnerShared] = React.useState(true);
  const [continuityMode, setContinuityMode] =
    React.useState<SequenceScheduleContinuityMode>("continue");
  const [timingMode, setTimingMode] = React.useState<BulkScheduleTimingMode>("auto");
  const [startPreset, setStartPreset] = React.useState<BulkScheduleStartPreset>("tomorrow9");
  const [customStartDate, setCustomStartDate] = React.useState("");
  const [customStartTime, setCustomStartTime] = React.useState("09:00");
  const [includeSignature, setIncludeSignature] = React.useState(true);
  const [includeFooter, setIncludeFooter] = React.useState(true);
  const [rows, setRows] = React.useState<LeadRow[]>([]);
  const [progressIndex, setProgressIndex] = React.useState(0);
  const [runTotal, setRunTotal] = React.useState(0);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const cancelRef = React.useRef(false);
  const wasOpenRef = React.useRef(false);
  const listRef = React.useRef<HTMLUListElement | null>(null);

  // Keep latest workspace data in refs so the batch loop and open-init
  // don't reset UI when followups/leads update mid-run.
  const leadsRef = React.useRef(leads);
  const followupsRef = React.useRef(followups);
  const followupPlansRef = React.useRef(followupPlans);
  const getContactByIdRef = React.useRef(getContactById);
  const sendableMailboxesRef = React.useRef(sendableMailboxes);
  const onCompleteRef = React.useRef(onComplete);
  leadsRef.current = leads;
  followupsRef.current = followups;
  followupPlansRef.current = followupPlans;
  getContactByIdRef.current = getContactById;
  sendableMailboxesRef.current = sendableMailboxes;
  onCompleteRef.current = onComplete;

  function ownerLabel(ownerId: string): string {
    if (!ownerId.trim()) return "Open queue";
    return (
      getOwnerDisplayName(ownerId)?.trim() ||
      (ownerId === currentUserId ? "You" : "Unknown owner")
    );
  }

  const classifyLead = React.useCallback(
    (leadId: string): { bucket: PreflightBucket; reason?: string } => {
      const lead = leadsRef.current.find((l) => l.id === leadId);
      if (!lead) return { bucket: "skipped", reason: "Lead not found" };
      if (lead.doNotContact) return { bucket: "skipped", reason: "Do not contact" };

      const plan = getActiveFollowupPlanForLead(followupPlansRef.current, leadId);
      if (!plan) return { bucket: "skipped", reason: "No active sequence" };

      const contact = getContactByIdRef.current(lead.contactId);
      const recipient = defaultContactRecipientEmail(
        buildContactRecipientOptions(lead, contact),
      );
      if (!recipient) return { bucket: "skipped", reason: "No recipient email" };

      const openSteps = openFollowupsForPlan(followupsRef.current, plan.id);
      const readySteps = openSteps.filter((f) => canAutoScheduleFollowupEmail(f, lead.channel));
      if (readySteps.length > 0) return { bucket: "ready" };

      // Email-capable steps that are already queued (canAutoSchedule excludes scheduledEmailId).
      const emailCapableQueued = openSteps.filter((f) => {
        if (!f.messageBody?.trim() || !f.scheduledEmailId) return false;
        if (f.pausedAt || f.completedAt) return false;
        const ch = resolveFollowupChannel(f.channel, lead.channel);
        return !(
          ch === "linkedin_outbound" ||
          ch === "linkedin_1to1" ||
          ch === "upwork" ||
          ch === "job_apply"
        );
      });
      if (emailCapableQueued.length > 0) {
        return { bucket: "already_scheduled" };
      }
      return { bucket: "skipped", reason: "No email steps to schedule" };
    },
    [],
  );

  // Snapshot preflight when the dialog opens so the setup counts stay stable
  // while scheduling updates followup state in the background.
  const [preflight, setPreflight] = React.useState({
    ready: 0,
    already: 0,
    skipped: 0,
    readyOwnerIds: [] as string[],
    readyLeadIds: [] as string[],
  });
  const [continuityCounts, setContinuityCounts] = React.useState({
    firstTouch: 0,
    continuing: 0,
    priorSenderKnown: 0,
    priorSenderUnknown: 0,
  });

  const selectedMailboxes = React.useMemo(
    () => sendableMailboxes.filter((m) => selectedMailboxIds.includes(m.id)),
    [sendableMailboxes, selectedMailboxIds],
  );

  const priorSenderOutsidePool = React.useMemo(() => {
    if (continuityMode !== "continue" || continuityCounts.continuing === 0) return 0;
    let count = 0;
    const selectedSet = new Set(selectedMailboxIds);
    for (const leadId of preflight.readyLeadIds) {
      const plan = getActiveFollowupPlanForLead(followupPlansRef.current, leadId);
      if (!plan) continue;
      const planSteps = followupsRef.current.filter((f) => f.planId === plan.id);
      const prior = resolvePriorSequenceSender({
        planFollowups: planSteps,
        scheduledEmails: scheduled,
        mailboxes: sendableMailboxes,
      });
      if (prior && !selectedSet.has(prior.mailboxId)) count += 1;
    }
    return count;
  }, [
    continuityMode,
    continuityCounts.continuing,
    preflight.readyLeadIds,
    selectedMailboxIds,
    scheduled,
    sendableMailboxes,
  ]);

  const hasOtherOwners = React.useMemo(() => {
    return preflight.readyOwnerIds.some(
      (oid) => oid && oid !== currentUserId,
    );
  }, [preflight.readyOwnerIds, currentUserId]);

  const ownerMatchGroups = React.useMemo(() => {
    if (!preferOwnerShared || !hasOtherOwners) return [];
    return buildOwnerMailboxMatchGroups({
      leadOwnerIds: preflight.readyOwnerIds,
      selectedMailboxes,
      viewerUid: currentUserId,
    });
  }, [
    preferOwnerShared,
    hasOtherOwners,
    preflight.readyOwnerIds,
    selectedMailboxes,
    currentUserId,
  ]);

  const ownerMatchBlockedCount = React.useMemo(() => {
    if (!preferOwnerShared) return 0;
    return ownerMatchGroups
      .filter((g) => !g.isSelfOrOpen && g.sharedMailboxIds.length === 0)
      .reduce((sum, g) => sum + g.leadCount, 0);
  }, [preferOwnerShared, ownerMatchGroups]);

  function computePreflight(ids: string[]) {
    let ready = 0;
    let already = 0;
    let skipped = 0;
    const readyOwnerIds: string[] = [];
    const readyLeadIds: string[] = [];
    for (const id of ids) {
      const c = classifyLead(id);
      if (c.bucket === "ready") {
        ready += 1;
        readyLeadIds.push(id);
        const lead = leadsRef.current.find((l) => l.id === id);
        readyOwnerIds.push(lead?.ownerId?.trim() || "");
      } else if (c.bucket === "already_scheduled") already += 1;
      else skipped += 1;
    }
    return { ready, already, skipped, readyOwnerIds, readyLeadIds };
  }

  // Only reset when the dialog opens (false → true). Do not reset when
  // leads/followups change mid-run — that was bouncing users back to setup
  // with a live-climbing "already scheduled" counter.
  React.useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened) return;

    cancelRef.current = false;
    setPhase("setup");
    setIncludeSignature(true);
    setIncludeFooter(true);
    setPreferOwnerShared(true);
    setContinuityMode("continue");
    setTimingMode("auto");
    setStartPreset("tomorrow9");
    const customDefaults = defaultCustomDueInputs(timeZone);
    setCustomStartDate(customDefaults.dueDate);
    setCustomStartTime(customDefaults.dueTime);
    setLoadError(null);
    setProgressIndex(0);
    setRunTotal(0);
    const prefs = loadLastUsedMailboxPrefs(organizationId, currentUserId);
    const defaults = resolveDefaultScheduleMailboxPool({
      mailboxIds: sendableMailboxesRef.current.map((m) => m.id),
      lastPoolIds: prefs.lastMailboxPoolIds,
    });
    setSelectedMailboxIds(defaults);
    const snap = computePreflight(leadIds);
    setPreflight(snap);
    const planFollowupsByLeadId = new Map<string, Followup[]>();
    for (const id of snap.readyLeadIds) {
      const plan = getActiveFollowupPlanForLead(followupPlansRef.current, id);
      if (!plan) {
        planFollowupsByLeadId.set(id, []);
        continue;
      }
      planFollowupsByLeadId.set(
        id,
        followupsRef.current.filter((f) => f.planId === plan.id),
      );
    }
    setContinuityCounts(
      countContinuityPreflight({
        readyLeadIds: snap.readyLeadIds,
        planFollowupsByLeadId,
        scheduledEmails: scheduled,
        mailboxes: sendableMailboxesRef.current,
      }),
    );
    setRows(
      snap.readyLeadIds.map((id) => {
        const lead = leadsRef.current.find((l) => l.id === id);
        return {
          leadId: id,
          label: lead ? leadLabel(lead) : id,
          status: "pending" as const,
        };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally open-transition only
  }, [open, leadIds, organizationId, currentUserId]);

  function toggleMailbox(id: string, checked: boolean) {
    setSelectedMailboxIds((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id];
      return prev.filter((x) => x !== id);
    });
  }

  function patchRow(leadId: string, patch: Partial<LeadRow>) {
    setRows((prev) => prev.map((r) => (r.leadId === leadId ? { ...r, ...patch } : r)));
  }

  React.useEffect(() => {
    if (phase !== "running") return;
    const el = listRef.current?.querySelector('[data-status="running"]');
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [phase, progressIndex]);

  async function runBatch(mode: "preview" | "commit" = "commit") {
    const selected = sendableMailboxesRef.current.filter((m) =>
      selectedMailboxIds.includes(m.id),
    );
    if (selected.length === 0) {
      toast.error("Select at least one mailbox");
      return;
    }

    const startIso =
      timingMode === "start_on"
        ? resolveBulkScheduleStartIso({
            preset: startPreset,
            timeZone,
            customDate: customStartDate,
            customTime: customStartTime,
          })
        : "";
    if (timingMode === "start_on" && !isBulkScheduleStartInFuture(startIso)) {
      toast.error("Pick a start time at least one minute from now");
      return;
    }

    // Re-classify at start so we schedule current-ready only, then freeze that list.
    const snap = computePreflight(leadIds);
    setPreflight(snap);
    if (snap.ready === 0) {
      toast.error("No prospects are ready to schedule");
      return;
    }

    const queue = snap.readyLeadIds;
    cancelRef.current = false;
    setPhase(mode === "preview" ? "preview" : "running");
    setProgressIndex(0);
    setRunTotal(queue.length);
    setLoadError(null);
    if (mode === "preview") {
      previewPlansRef.current = [];
      setPreviewReady(false);
    }
    setRows(
      queue.map((id) => {
        const lead = leadsRef.current.find((l) => l.id === id);
        return {
          leadId: id,
          label: lead ? leadLabel(lead) : id,
          status: "pending" as const,
        };
      }),
    );
    rememberLastUsedMailboxPool(
      organizationId,
      currentUserId,
      selected.map((m) => m.id),
    );

    const loaded = await loadMailboxCapacityStates({
      mailboxes: selected,
      isDemo,
      scheduled,
      timeZone,
    });
    if (!loaded.ok) {
      setLoadError(loaded.error);
      setPhase("setup");
      toast.error(loaded.error);
      return;
    }

    let orgRemainingByDay: Record<string, number> | undefined;
    let orgCeiling: number | null = organizationSendPolicy.dailyCeiling;
    if (!isDemo) {
      try {
        const capRes = await fetch("/api/email/org-capacity?horizonDays=60");
        const capData = (await capRes.json()) as {
          ok?: boolean;
          ceiling?: number | null;
          remainingByDay?: Record<string, number>;
        };
        if (capData.ok) {
          orgCeiling = capData.ceiling ?? orgCeiling;
          orgRemainingByDay = capData.remainingByDay;
        }
      } catch {
        /* client assignment still proceeds; server enforces ceiling */
      }
    }

    let states: MailboxCapacityState[] = loaded.states;
    let rr = 0;
    let success = 0;
    let skipped = 0;
    let failed = 0;
    const mailboxById = new Map(selected.map((m) => [m.id, m]));

    for (let i = 0; i < queue.length; i++) {
      if (cancelRef.current) {
        for (let j = i; j < queue.length; j++) {
          patchRow(queue[j]!, { status: "skipped", detail: "Cancelled" });
          skipped += 1;
        }
        break;
      }

      const leadId = queue[i]!;
      setProgressIndex(i + 1);
      patchRow(leadId, { status: "running", detail: undefined });

      const classified = classifyLead(leadId);
      if (classified.bucket !== "ready") {
        patchRow(leadId, {
          status: "skipped",
          detail:
            classified.bucket === "already_scheduled"
              ? "Already scheduled"
              : classified.reason ?? "Skipped",
        });
        skipped += 1;
        continue;
      }

      const lead = leadsRef.current.find((l) => l.id === leadId)!;
      const plan = getActiveFollowupPlanForLead(followupPlansRef.current, leadId)!;
      const contact = getContactByIdRef.current(lead.contactId);
      const to = defaultContactRecipientEmail(buildContactRecipientOptions(lead, contact));
      const planSteps = followupsRef.current.filter((f) => f.planId === plan.id);
      const schedulable = openFollowupsForPlan(followupsRef.current, plan.id)
        .filter((f) => canAutoScheduleFollowupEmail(f, lead.channel))
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt));

      const sendWindow = resolveLeadSendWindow({
        strategyId: lead.strategyId,
        strategies: prospecting.strategies,
      });

      const draftSteps =
        startIso
          ? shiftSequenceStepsToStart(schedulable, startIso)
          : schedulable.map((f) => ({
              id: f.id,
              scheduledAt: isoFromDatetimeLocalInZone(
                defaultAudienceScheduleDatetimeLocal({
                  preferIso: f.dueAt,
                  timeZone,
                  sendWindowStartHour: sendWindow.startHour,
                  sendWindowEndHour: sendWindow.endHour,
                  spreadKey: f.id,
                  sendPolicy: organizationSendPolicy,
                }),
                timeZone,
              ),
              included: true,
            }));

      let candidateMailboxIds: string[] | undefined;
      if (preferOwnerShared) {
        const shared = filterMailboxesSharedWithLeadOwner({
          mailboxes: selected,
          leadOwnerId: lead.ownerId,
          viewerUid: currentUserId,
        });
        if (shared.length === 0) {
          patchRow(leadId, {
            status: "skipped",
            detail: ownerSharedMailboxSkipReason(ownerLabel(lead.ownerId?.trim() || "")),
          });
          skipped += 1;
          continue;
        }
        const ownerId = lead.ownerId?.trim() || "";
        const needsRestrict = Boolean(ownerId && ownerId !== currentUserId);
        if (needsRestrict) {
          candidateMailboxIds = shared.map((m) => m.id);
        }
      }

      const startFresh = continuityMode === "start_fresh";
      const priorSender =
        !startFresh
          ? resolvePriorSequenceSender({
              planFollowups: planSteps,
              scheduledEmails: scheduled,
              mailboxes: sendableMailboxesRef.current,
            })
          : null;
      const preferPrior =
        priorSender &&
        selected.some((m) => m.id === priorSender.mailboxId) &&
        (candidateMailboxIds == null || candidateMailboxIds.includes(priorSender.mailboxId))
          ? priorSender.mailboxId
          : undefined;

      const assigned = assignProspectSchedule({
        states,
        steps: draftSteps,
        roundRobinIndex: rr,
        timeZone,
        candidateMailboxIds,
        preferredMailboxId: preferPrior,
        sendPolicy: organizationSendPolicy,
        orgCeiling,
        orgRemainingByDay,
      });
      rr = assigned.nextRoundRobinIndex;
      states = assigned.nextStates;
      if (assigned.nextOrgRemainingByDay) orgRemainingByDay = assigned.nextOrgRemainingByDay;

      if (!assigned.ok) {
        patchRow(leadId, {
          status: "failed",
          detail: assigned.error,
        });
        failed += 1;
        continue;
      }

      const mailbox = mailboxById.get(assigned.mailboxId);
      if (!mailbox) {
        patchRow(leadId, { status: "failed", detail: "Mailbox missing" });
        failed += 1;
        continue;
      }

      const senderChanged =
        Boolean(priorSender) && priorSender!.mailboxId !== assigned.mailboxId;

      if (mode === "preview") {
        previewPlansRef.current.push({
          leadId,
          mailboxId: assigned.mailboxId,
          steps: assigned.steps,
          startFresh,
        });
        const firstAt = assigned.steps.find((s) => s.included)?.scheduledAt;
        patchRow(leadId, {
          status: "success",
          detail: `${assigned.steps.filter((s) => s.included).length} email${
            assigned.steps.filter((s) => s.included).length === 1 ? "" : "s"
          } · ${mailboxOptionLabel(mailbox)}${
            firstAt ? ` · first ${formatInstantInZone(firstAt, timeZone)}` : ""
          }`,
        });
        success += 1;
        continue;
      }

      let okCount = 0;
      let lastError = "";
      for (const step of assigned.steps.filter((s) => s.included)) {
        const followupRaw = schedulable.find((f) => f.id === step.id);
        if (!followupRaw) continue;
        const followup = await hydrateFollowupMessageBody(followupRaw);
        const result = await scheduleFollowupEmailClient({
          followupId: followup.id,
          leadId: lead.id,
          mailbox,
          to,
          subject: followup.emailSubject?.trim() || followup.title,
          body: followup.messageBody ?? "",
          includeSignature,
          globalEmailFooter,
          includeFooter,
          scheduledAtIso: toScheduleIso(step.scheduledAt, timeZone),
          isDemo,
          forceNewThread: startFresh,
          addDemoScheduled: addScheduled,
        });
        if (!result.ok) {
          lastError = result.error;
          break;
        }
        setFollowupEmailSchedule(followup.id, {
          scheduledEmailId: result.scheduledEmailId,
          emailScheduledAt: result.emailScheduledAt,
          freshThread: startFresh,
        });
        updateFollowup(followup.id, { dueAt: result.emailScheduledAt });
        okCount += 1;
      }

      if (okCount === 0) {
        patchRow(leadId, {
          status: "failed",
          detail: lastError || "Could not schedule",
        });
        failed += 1;
        continue;
      }

      const continuityNote = startFresh
        ? " · new thread"
        : priorSender
          ? senderChanged
            ? " · same thread · different sender"
            : " · same thread"
          : "";

      patchRow(leadId, {
        status: "success",
        detail: `${okCount} email${okCount === 1 ? "" : "s"} · ${mailboxOptionLabel(mailbox)}${
          okCount < schedulable.length ? " (partial)" : ""
        }${continuityNote}`,
      });
      success += 1;
    }

    if (mode === "preview") {
      const counts = new Map<string, number>();
      for (const plan of previewPlansRef.current) {
        for (const step of plan.steps) {
          if (!step.included) continue;
          const day = scheduleDayKeyFromDate(step.scheduledAt, timeZone);
          if (!day) continue;
          counts.set(day, (counts.get(day) ?? 0) + 1);
        }
      }
      setPreviewByDay(
        [...counts.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([day, count]) => ({ day, count })),
      );
      const mailboxCounts = new Map<string, number>();
      for (const plan of previewPlansRef.current) {
        const n = plan.steps.filter((s) => s.included).length;
        if (n === 0) continue;
        mailboxCounts.set(plan.mailboxId, (mailboxCounts.get(plan.mailboxId) ?? 0) + n);
      }
      setPreviewByMailbox(
        [...mailboxCounts.entries()]
          .map(([mailboxId, count]) => {
            const mailbox = mailboxById.get(mailboxId);
            return {
              mailboxId,
              label: mailbox ? mailboxOptionLabel(mailbox) : mailboxId,
              count,
            };
          })
          .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      );
      setPreviewReady(true);
      setPhase("preview");
      return;
    }

    setPhase("done");
    toast.success(
      `Scheduled ${success} prospect${success === 1 ? "" : "s"}`,
      skipped || failed
        ? { description: `${skipped} skipped · ${failed} failed` }
        : undefined,
    );
    if (failed === 0 && success > 0) {
      onCompleteRef.current?.();
    }
  }

  function handleClose(next: boolean) {
    if (phase === "running") return;
    onOpenChange(next);
  }

  const successCount = rows.filter((r) => r.status === "success").length;
  const skippedCount = rows.filter((r) => r.status === "skipped").length;
  const failedCount = rows.filter((r) => r.status === "failed").length;
  const progressPct =
    runTotal > 0 ? Math.min(100, Math.round((progressIndex / runTotal) * 100)) : 0;

  const signatureMailbox =
    sendableMailboxes.find((m) => m.id === selectedMailboxIds[0]) ?? sendableMailboxes[0];

  const startOnIso = React.useMemo(() => {
    if (timingMode !== "start_on") return "";
    return resolveBulkScheduleStartIso({
      preset: startPreset,
      timeZone,
      customDate: customStartDate,
      customTime: customStartTime,
    });
  }, [timingMode, startPreset, timeZone, customStartDate, customStartTime]);

  const startOnLabel = startOnIso
    ? formatInstantInZone(startOnIso, timeZone, { year: true })
    : "";
  const startOnValid = Boolean(startOnIso) && isBulkScheduleStartInFuture(startOnIso);
  const minStartDate = todayDateInputInZone(timeZone);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <CalendarClock className="h-4 w-4 text-primary" />
            Schedule sequences
          </DialogTitle>
          <DialogDescription className="text-xs">
            {phase === "setup"
              ? "Queue email steps from existing active sequences across selected inboxes, using each mailbox's daily send limit. When scheduling for other owners, prefer inboxes you both can send from."
              : phase === "preview"
                ? "Review where emails will land before they are queued. Overflow moves to the next working day with capacity."
              : phase === "running"
                ? "Queuing email steps across your selected inboxes. You can stop after the current prospect."
                : "All selected prospects have been processed."}
          </DialogDescription>
        </DialogHeader>

        {phase === "setup" ? (
          <div className="space-y-4 py-1">
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-1">
              <p>
                <span className="font-medium tabular-nums">{preflight.ready}</span> ready to
                schedule
              </p>
              {(preflight.already > 0 || preflight.skipped > 0) && (
                <p className="text-muted-foreground">
                  {preflight.already > 0 ? (
                    <span className="tabular-nums">{preflight.already} already scheduled</span>
                  ) : null}
                  {preflight.already > 0 && preflight.skipped > 0 ? " · " : null}
                  {preflight.skipped > 0 ? (
                    <span className="tabular-nums">{preflight.skipped} skipped</span>
                  ) : null}
                </p>
              )}
              {continuityCounts.continuing > 0 || continuityCounts.firstTouch > 0 ? (
                <p className="text-muted-foreground">
                  <span className="tabular-nums">{continuityCounts.continuing}</span> will
                  continue existing threads
                  {" · "}
                  <span className="tabular-nums">{continuityCounts.firstTouch}</span>{" "}
                  first-touch
                </p>
              ) : null}
            </div>

            {continuityCounts.continuing > 0 ? (
              <div className="space-y-2 rounded-md border p-3">
                <Label className="text-xs">For leads with prior sent steps</Label>
                <RadioGroup
                  value={continuityMode}
                  onValueChange={(v) =>
                    setContinuityMode(v as SequenceScheduleContinuityMode)
                  }
                  className="grid gap-2"
                >
                  <label
                    htmlFor="bulk-sched-continue"
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors",
                      continuityMode === "continue"
                        ? "border-primary bg-primary/5"
                        : "border-border/60 hover:bg-muted/40",
                    )}
                  >
                    <RadioGroupItem
                      value="continue"
                      id="bulk-sched-continue"
                      className="mt-0.5"
                    />
                    <span className="min-w-0 space-y-0.5">
                      <span className="block font-medium leading-none">
                        Continue conversation
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        Same thread. Prefer the mailbox that sent earlier steps when it is
                        in your pool.
                      </span>
                    </span>
                  </label>
                  <label
                    htmlFor="bulk-sched-fresh"
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors",
                      continuityMode === "start_fresh"
                        ? "border-primary bg-primary/5"
                        : "border-border/60 hover:bg-muted/40",
                    )}
                  >
                    <RadioGroupItem
                      value="start_fresh"
                      id="bulk-sched-fresh"
                      className="mt-0.5"
                    />
                    <span className="min-w-0 space-y-0.5">
                      <span className="block font-medium leading-none">Start fresh</span>
                      <span className="block text-[11px] text-muted-foreground">
                        New thread from the selected pool — use for a new campaign or
                        sender.
                      </span>
                    </span>
                  </label>
                </RadioGroup>
                {continuityMode === "continue" && continuityCounts.priorSenderUnknown > 0 ? (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    Prior sender unknown for {continuityCounts.priorSenderUnknown} lead
                    {continuityCounts.priorSenderUnknown === 1 ? "" : "s"} (e.g. Instantly) —
                    will use the selected pool while staying in the same thread.
                  </p>
                ) : null}
                {continuityMode === "continue" && priorSenderOutsidePool > 0 ? (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    Prior sender is outside the selected pool for {priorSenderOutsidePool}{" "}
                    lead{priorSenderOutsidePool === 1 ? "" : "s"} — those will use another
                    mailbox in the same thread.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-2 rounded-md border p-3">
              <Label className="text-xs">When should emails go out?</Label>
              <RadioGroup
                value={timingMode}
                onValueChange={(v) => setTimingMode(v as BulkScheduleTimingMode)}
                className="grid gap-2"
              >
                <label
                  htmlFor="bulk-sched-timing-auto"
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors",
                    timingMode === "auto"
                      ? "border-primary bg-primary/5"
                      : "border-border/60 hover:bg-muted/40",
                  )}
                >
                  <RadioGroupItem
                    value="auto"
                    id="bulk-sched-timing-auto"
                    className="mt-0.5"
                  />
                  <span className="min-w-0 space-y-0.5">
                    <span className="block font-medium leading-none">Auto</span>
                    <span className="block text-[11px] text-muted-foreground">
                      Use each step&apos;s due date, snap into the send window, and shift
                      days if a mailbox is full.
                    </span>
                  </span>
                </label>
                <div
                  className={cn(
                    "rounded-md border px-2.5 py-2 text-sm transition-colors",
                    timingMode === "start_on"
                      ? "border-primary bg-primary/5"
                      : "border-border/60 hover:bg-muted/40",
                  )}
                >
                  <label
                    htmlFor="bulk-sched-timing-start"
                    className="flex cursor-pointer items-start gap-2"
                  >
                    <RadioGroupItem
                      value="start_on"
                      id="bulk-sched-timing-start"
                      className="mt-0.5"
                    />
                    <span className="min-w-0 space-y-0.5">
                      <span className="block font-medium leading-none">Start on a date</span>
                      <span className="block text-[11px] text-muted-foreground">
                        First email at this time. Later steps keep their spacing.
                      </span>
                    </span>
                  </label>
                  {timingMode === "start_on" ? (
                    <div className="mt-2 space-y-2 pl-6">
                      <div className="flex flex-wrap gap-2">
                        {START_PRESETS.map((p) => (
                          <Button
                            key={p.id}
                            type="button"
                            size="sm"
                            variant={startPreset === p.id ? "default" : "outline"}
                            className="h-8 text-xs"
                            onClick={() => setStartPreset(p.id)}
                          >
                            {p.label}
                          </Button>
                        ))}
                      </div>
                      {startPreset === "custom" ? (
                        <div className="grid grid-cols-2 gap-2">
                          <div className="grid gap-1">
                            <Label htmlFor="bulk-sched-start-date" className="text-[11px]">
                              Date
                            </Label>
                            <Input
                              id="bulk-sched-start-date"
                              type="date"
                              min={minStartDate}
                              value={customStartDate}
                              onChange={(e) => setCustomStartDate(e.target.value)}
                              className="h-8"
                            />
                          </div>
                          <div className="grid gap-1">
                            <Label htmlFor="bulk-sched-start-time" className="text-[11px]">
                              Time
                            </Label>
                            <Input
                              id="bulk-sched-start-time"
                              type="time"
                              value={customStartTime}
                              onChange={(e) => setCustomStartTime(e.target.value)}
                              className="h-8"
                            />
                          </div>
                        </div>
                      ) : null}
                      <p
                        className={cn(
                          "text-[11px] tabular-nums",
                          startOnValid
                            ? "text-muted-foreground"
                            : "text-amber-700 dark:text-amber-400",
                        )}
                      >
                        {startOnValid
                          ? `${preflight.ready} sequence${preflight.ready === 1 ? "" : "s"} → first email ${startOnLabel} · later steps keep their gaps`
                          : startOnLabel
                            ? "Start time must be at least one minute from now."
                            : "Choose a valid date and time."}
                      </p>
                    </div>
                  ) : null}
                </div>
              </RadioGroup>
            </div>

            {sendableMailboxes.length === 0 ? (
              <p className="text-sm text-destructive">
                No send-capable mailboxes. Configure SMTP in Settings → Email.
              </p>
            ) : (
              <div className="space-y-2">
                <Label className="text-xs">Mailboxes</Label>
                <ul className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-2">
                  {sendableMailboxes.map((mb) => {
                    const checked = selectedMailboxIds.includes(mb.id);
                    return (
                      <li key={mb.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => toggleMailbox(mb.id, v === true)}
                          id={`bulk-sched-mb-${mb.id}`}
                        />
                        <label
                          htmlFor={`bulk-sched-mb-${mb.id}`}
                          className="cursor-pointer truncate"
                        >
                          {mailboxOptionLabel(mb)}
                          {mb.dailySendLimit != null ? (
                            <span className="text-muted-foreground">
                              {" "}
                              · {mb.dailySendLimit}/day
                            </span>
                          ) : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {hasOtherOwners ? (
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="bulk-sched-prefer-owner"
                    checked={preferOwnerShared}
                    onCheckedChange={(v) => setPreferOwnerShared(v === true)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 space-y-1">
                    <label
                      htmlFor="bulk-sched-prefer-owner"
                      className="cursor-pointer text-sm font-medium leading-none"
                    >
                      Prefer owner-shared inboxes
                    </label>
                    <p className="text-[11px] text-muted-foreground">
                      For leads you don&apos;t own, only use mailboxes that owner can also send
                      from (assigned or their inbox shared with you).
                    </p>
                  </div>
                </div>

                {preferOwnerShared && ownerMatchGroups.length > 0 ? (
                  <ul className="space-y-1.5 border-t pt-2 text-[11px]">
                    {ownerMatchGroups.map((g) => {
                      const name = ownerLabel(g.ownerId);
                      const blocked = !g.isSelfOrOpen && g.sharedMailboxIds.length === 0;
                      return (
                        <li
                          key={g.ownerId || "__open__"}
                          className={cn(
                            "flex items-baseline justify-between gap-2",
                            blocked && "text-amber-700 dark:text-amber-400",
                          )}
                        >
                          <span className="truncate">
                            <span className="font-medium">{name}</span>
                            <span className="text-muted-foreground">
                              {" "}
                              · {g.leadCount} lead{g.leadCount === 1 ? "" : "s"}
                            </span>
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            {g.isSelfOrOpen
                              ? `${selectedMailboxes.length} mailbox${selectedMailboxes.length === 1 ? "" : "es"}`
                              : blocked
                                ? "no shared inbox"
                                : `${g.sharedMailboxIds.length} shared`}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}

                {preferOwnerShared && ownerMatchBlockedCount > 0 ? (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    {ownerMatchBlockedCount} lead
                    {ownerMatchBlockedCount === 1 ? "" : "s"} will be skipped — share send access
                    in Settings → Email, or turn this off.
                  </p>
                ) : null}
              </div>
            ) : null}

            {signatureMailbox ? (
              <MailboxSignaturePreview
                id="bulk-sched-include-signature"
                signature={signatureMailbox.signature}
                includeSignature={includeSignature}
                onIncludeChange={setIncludeSignature}
                mailboxLabel={mailboxOptionLabel(signatureMailbox)}
              />
            ) : null}
            <GlobalEmailFooterPreview
              id="bulk-sched-include-footer"
              footer={globalEmailFooter}
              includeFooter={includeFooter}
              onIncludeChange={setIncludeFooter}
            />

            {loadError ? (
              <p className="text-xs text-destructive">{loadError}</p>
            ) : null}

            <DialogFooter className="gap-2 sm:justify-between">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={
                  selectedMailboxIds.length === 0 ||
                  preflight.ready === 0 ||
                  sendableMailboxes.length === 0 ||
                  (timingMode === "start_on" && !startOnValid) ||
                  (preferOwnerShared &&
                    hasOtherOwners &&
                    ownerMatchBlockedCount >= preflight.ready)
                }
                onClick={() => void runBatch("preview")}
              >
                <CalendarClock className="h-3.5 w-3.5" />
                Review{" "}
                {preferOwnerShared && ownerMatchBlockedCount > 0
                  ? Math.max(0, preflight.ready - ownerMatchBlockedCount)
                  : preflight.ready}{" "}
                ready
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {phase === "preview" ? (
          <div className="space-y-3 py-1">
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-1">
              <p className="font-medium">Planned send days</p>
              {previewByDay.length === 0 ? (
                <p className="text-muted-foreground">No emails could be placed.</p>
              ) : (
                previewByDay.map((row) => (
                  <p key={row.day} className="tabular-nums">
                    {formatScheduleDayLabel(row.day, timeZone)} · {row.count} email
                    {row.count === 1 ? "" : "s"}
                  </p>
                ))
              )}
              {previewByMailbox.length > 0 ? (
                <div className="space-y-1 border-t pt-1.5">
                  <p className="font-medium">Inbox fill</p>
                  {previewByMailbox.map((row) => (
                    <p key={row.mailboxId} className="tabular-nums">
                      {row.label} · {row.count} email{row.count === 1 ? "" : "s"}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
              {rows.map((row) => (
                <li key={row.leadId} className="rounded px-1.5 py-1 text-xs">
                  <p className="truncate font-medium">{row.label}</p>
                  {row.detail ? (
                    <p className="text-[11px] text-muted-foreground">{row.detail}</p>
                  ) : null}
                </li>
              ))}
            </ul>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button type="button" variant="outline" onClick={() => setPhase("setup")}>
                Back
              </Button>
              <Button
                type="button"
                disabled={!previewReady || previewPlansRef.current.length === 0}
                onClick={() => void runBatch("commit")}
              >
                Confirm schedule
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {phase === "running" || phase === "done" ? (
          <div className="space-y-3 py-1">
            <div className="space-y-2 rounded-md border bg-muted/30 px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <p className="font-medium">
                  {phase === "running" ? (
                    <>
                      Scheduling{" "}
                      <span className="tabular-nums">
                        {progressIndex} / {runTotal}
                      </span>
                    </>
                  ) : (
                    <>
                      Done ·{" "}
                      <span className="tabular-nums text-emerald-600 dark:text-emerald-400">
                        {successCount} scheduled
                      </span>
                      {skippedCount > 0 ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · {skippedCount} skipped
                        </span>
                      ) : null}
                      {failedCount > 0 ? (
                        <span className="text-destructive"> · {failedCount} failed</span>
                      ) : null}
                    </>
                  )}
                </p>
                {phase === "running" ? (
                  <p className="tabular-nums text-muted-foreground">
                    {successCount} done
                    {failedCount > 0 ? ` · ${failedCount} failed` : ""}
                  </p>
                ) : null}
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={progressPct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-300 ease-out",
                    phase === "done" && failedCount === 0
                      ? "bg-emerald-500"
                      : phase === "done" && failedCount > 0
                        ? "bg-amber-500"
                        : "bg-primary",
                  )}
                  style={{ width: `${phase === "done" ? 100 : progressPct}%` }}
                />
              </div>
            </div>

            <ul
              ref={listRef}
              className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2"
            >
              {rows.map((row) => (
                <li
                  key={row.leadId}
                  data-status={row.status}
                  className={cn(
                    "flex items-start gap-2 rounded px-1.5 py-1 text-xs",
                    row.status === "running" && "bg-primary/5",
                    row.status === "pending" && "opacity-60",
                  )}
                >
                  {row.status === "running" ? (
                    <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                  ) : row.status === "pending" ? (
                    <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                  ) : row.status === "success" ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  ) : row.status === "skipped" ? (
                    <MinusCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{row.label}</p>
                    {row.detail ? (
                      <p className="text-[11px] text-muted-foreground">{row.detail}</p>
                    ) : row.status === "pending" ? (
                      <p className="text-[11px] text-muted-foreground">Waiting…</p>
                    ) : row.status === "running" ? (
                      <p className="text-[11px] text-muted-foreground">Scheduling…</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            <DialogFooter className="gap-2 sm:justify-between">
              {phase === "running" ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    cancelRef.current = true;
                  }}
                >
                  Stop after current
                </Button>
              ) : (
                <Button type="button" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              )}
              <span />
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
