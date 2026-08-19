"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  endOfWeek,
  format,
} from "date-fns";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/common/kpi-card";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { WorkspacePageSkeleton } from "@/components/common/workspace-page-skeleton";
import { fmtRelative } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Followup } from "@/lib/types";
import { canMutateFollowup } from "@/lib/can-mutate-followup";
import { isFollowupActionable } from "@/lib/followup-open-status";
import { useOrgTimezone } from "@/hooks/use-org-timezone";
import {
  todayDateInputInZone,
  zonedDayKey,
  zonedWallTimeToUtc,
} from "@/lib/org-timezone";
import { cancelScheduledEmailClient } from "@/lib/cancel-followup-scheduled-email-client";
import { retryScheduledEmailClient } from "@/lib/retry-scheduled-email-client";
import { followupScheduleMailboxFields, scheduleFollowupEmailClient } from "@/lib/schedule-followup-email-client";
import { hydrateFollowupMessageBody } from "@/lib/documents/fetch-followup-message-body-client";
import {
  followupQueueKind,
  isFollowupEmailChannel,
  matchesFollowupChannelFilter,
  resolveFollowupLeadChannel,
  type FollowupChannelFilter,
} from "@/lib/followup-plans";
import {
  buildContactRecipientOptions,
  defaultContactRecipientEmail,
} from "@/lib/email/contact-recipient-options";
import {
  loadLastUsedMailboxPrefs,
  rememberLastUsedMailbox,
  resolveDefaultScheduleMailboxId,
} from "@/lib/email/last-used-mailbox-prefs";
import {
  getActiveMailbox,
  isEmailAccountConfigured,
  useEmailAccountStore,
} from "@/stores/email-account-store";
import {
  buildWorkspaceOwnerPickerOptions,
  filterFollowupsByOwnerScope,
  getOwnerFilterTriggerLabel,
  OWNER_SCOPE_PREFIX,
} from "@/lib/owner-scope";
import {
  isFollowupDeliveryIssue,
  planFollowupTryNow,
  tryNowDueAtIso,
  tryNowScheduleAtIso,
} from "@/lib/followup-due-display";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FollowupGroup } from "@/components/followups/followup-group";
import { ListPaginationBar } from "@/components/followups/list-pagination-bar";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FOLLOWUP_DEFAULT_PAGE_SIZE,
  readFollowupChannelFilter,
  readFollowupPageSize,
  writeFollowupChannelFilter,
  writeFollowupPageSize,
  type FollowupPageSize,
} from "@/lib/followup-queue-pagination";
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
import {
  BulkFollowupProgressDialog,
  type BulkFollowupProgress,
} from "@/components/followups/bulk-followup-progress-dialog";

const NewFollowupDialog = dynamic(
  () => import("@/components/followups/new-followup-dialog").then((m) => ({ default: m.NewFollowupDialog })),
  { ssr: false },
);

const RescheduleFollowupsDialog = dynamic(
  () =>
    import("@/components/followups/reschedule-followups-dialog").then((m) => ({
      default: m.RescheduleFollowupsDialog,
    })),
  { ssr: false },
);

function emptyBucketCopy(
  channelFilter: FollowupChannelFilter,
  allCopy: string,
  emailCopy: string,
  linkedinCopy: string,
): string {
  if (channelFilter === "email") return emailCopy;
  if (channelFilter === "linkedin") return linkedinCopy;
  return allCopy;
}

/**
 * Buckets relative to a chosen calendar day (org/browser TZ) and the ISO week
 * containing that day (Mon–Sun).
 */
function categorizeFollowupBucket(
  dueAt: string,
  anchorYmd: string,
  timeZone: string,
): "overdue" | "today" | "thisWeek" | "later" {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return "later";
  const dueKey = zonedDayKey(due, timeZone);
  if (dueKey < anchorYmd) return "overdue";
  if (dueKey === anchorYmd) return "today";

  const anchorNoon = zonedWallTimeToUtc(anchorYmd, 12, 0, 0, 0, timeZone);
  const weekEnd = endOfWeek(anchorNoon, { weekStartsOn: 1 });
  const weekEndKey = zonedDayKey(weekEnd, timeZone);
  if (dueKey <= weekEndKey) return "thisWeek";
  return "later";
}

type BucketFilter = "all" | "overdue" | "today" | "thisWeek";

export default function FollowupsPage() {
  const router = useRouter();
  const ws = useWorkspace();
  const timeZone = useOrgTimezone();
  const {
    followups: allFollowups,
    isDemo,
    followupsReady,
    leads,
    users,
    currentUserId,
    organizationId,
    addFollowup,
    setFollowupCompleted,
    removeFollowup,
    updateFollowup,
    clearFollowupEmailSchedule,
    setFollowupEmailSchedule,
    getOwnerDisplayName,
    getContactById,
    getLeadById,
  } = ws;
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<Followup | null>(null);
  const [tab, setTab] = React.useState<"open" | "completed">("open");
  const [bucketFilter, setBucketFilter] = React.useState<BucketFilter>("all");
  const [deleteTarget, setDeleteTarget] = React.useState<Followup | null>(null);
  const [ownerScope, setOwnerScope] = React.useState("all-owners");
  const [viewDateYmd, setViewDateYmd] = React.useState(() => todayDateInputInZone(timeZone));
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set());
  const [rescheduleOpen, setRescheduleOpen] = React.useState(false);
  const [retryConfirmOpen, setRetryConfirmOpen] = React.useState(false);
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [bulkProgress, setBulkProgress] = React.useState<BulkFollowupProgress | null>(null);
  const [channelFilter, setChannelFilter] = React.useState<FollowupChannelFilter>("all");
  const [pageSize, setPageSize] = React.useState<FollowupPageSize>(FOLLOWUP_DEFAULT_PAGE_SIZE);
  const [completedPageIndex, setCompletedPageIndex] = React.useState(0);

  const cancelScheduled = useEmailAccountStore((s) => s.cancelScheduled);
  const scheduledEmails = useEmailAccountStore((s) => s.scheduled);
  const setScheduled = useEmailAccountStore((s) => s.setScheduled);
  const addScheduled = useEmailAccountStore((s) => s.addScheduled);
  const globalEmailFooter = useEmailAccountStore((s) => s.globalEmailFooter);
  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const activeMailboxId = useEmailAccountStore((s) => s.activeMailboxId);
  const mailViewAsUid = useEmailAccountStore((s) => s.mailViewAsUid);
  const activeMailbox = getActiveMailbox({ mailboxes, activeMailboxId });
  const viewer = users.find((u) => u.id === currentUserId);
  const followupOwnerIds = React.useMemo(
    () => [...new Set(allFollowups.map((f) => f.ownerId).filter(Boolean))],
    [allFollowups],
  );

  const ownerPickerOptions = React.useMemo(
    () => buildWorkspaceOwnerPickerOptions(users, currentUserId, getOwnerDisplayName, followupOwnerIds),
    [users, currentUserId, getOwnerDisplayName, followupOwnerIds],
  );

  const ownerScopeDeps = React.useMemo(
    () => ({
      currentUserId,
      users,
      getUserById: ws.getUserById,
      getOwnerDisplayName,
    }),
    [currentUserId, users, ws.getUserById, getOwnerDisplayName],
  );

  const ownerFilterTriggerLabel = React.useMemo(
    () => getOwnerFilterTriggerLabel(ownerScope, ownerPickerOptions),
    [ownerScope, ownerPickerOptions],
  );

  const followups = React.useMemo(
    () => filterFollowupsByOwnerScope(allFollowups, ownerScope, ownerScopeDeps),
    [allFollowups, ownerScope, ownerScopeDeps],
  );

  const followupLeadChannel = React.useCallback(
    (f: Followup) =>
      resolveFollowupLeadChannel(f, f.leadId ? getLeadById(f.leadId)?.channel : undefined),
    [getLeadById],
  );

  React.useEffect(() => {
    setChannelFilter(readFollowupChannelFilter());
    setPageSize(readFollowupPageSize());
  }, []);

  const handleChannelFilterChange = React.useCallback((next: string) => {
    if (next !== "all" && next !== "email" && next !== "linkedin") return;
    setChannelFilter(next);
    writeFollowupChannelFilter(next);
  }, []);

  const handlePageSizeChange = React.useCallback((next: FollowupPageSize) => {
    setPageSize(next);
    writeFollowupPageSize(next);
    setCompletedPageIndex(0);
  }, []);

  const todayYmd = todayDateInputInZone(timeZone);
  const anchorDay = React.useMemo(
    () => zonedWallTimeToUtc(viewDateYmd, 12, 0, 0, 0, timeZone),
    [viewDateYmd, timeZone],
  );
  const isViewToday = viewDateYmd === todayYmd;
  const dueAnchorBucketTitle = isViewToday ? "Due today" : `Due ${format(anchorDay, "MMM d")}`;
  const dueAnchorKpiLabel = isViewToday ? "Due today" : `Due ${format(anchorDay, "MMM d")}`;

  const canMutateRow = React.useCallback(
    (f: Followup) =>
      canMutateFollowup({
        currentUserId,
        viewer,
        lead: f.leadId ? ws.getLeadById(f.leadId) : undefined,
        followup: f,
      }),
    [currentUserId, viewer, ws],
  );

  const openAll = React.useMemo(
    () =>
      followups.filter((f) => {
        if (f.completedAt) return false;
        // Keep delivery failures visible in the queue; other terminal states stay out of due buckets.
        if (f.deliveryStatus === "failed" || f.deliveryStatus === "needs_retry") return true;
        return isFollowupActionable(f);
      }),
    [followups],
  );
  const doneAll = React.useMemo(
    () =>
      followups
        .filter((f) => f.completedAt)
        .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
    [followups],
  );

  const channelOpenCounts = React.useMemo(() => {
    let email = 0;
    let linkedin = 0;
    for (const f of openAll) {
      const kind = followupQueueKind(f, followupLeadChannel(f));
      if (kind === "email") email += 1;
      else if (kind === "linkedin") linkedin += 1;
    }
    return { all: openAll.length, email, linkedin };
  }, [openAll, followupLeadChannel]);

  const open = React.useMemo(
    () =>
      channelFilter === "all"
        ? openAll
        : openAll.filter((f) => matchesFollowupChannelFilter(f, followupLeadChannel(f), channelFilter)),
    [openAll, channelFilter, followupLeadChannel],
  );
  const done = React.useMemo(
    () =>
      channelFilter === "all"
        ? doneAll
        : doneAll.filter((f) => matchesFollowupChannelFilter(f, followupLeadChannel(f), channelFilter)),
    [doneAll, channelFilter, followupLeadChannel],
  );

  const completedTotalPages = Math.max(1, Math.ceil(done.length / pageSize));
  const safeCompletedPageIndex = Math.min(completedPageIndex, completedTotalPages - 1);
  const doneVisible = React.useMemo(
    () =>
      done.slice(
        safeCompletedPageIndex * pageSize,
        safeCompletedPageIndex * pageSize + pageSize,
      ),
    [done, safeCompletedPageIndex, pageSize],
  );

  const failed = React.useMemo(
    () => open.filter((f) => isFollowupDeliveryIssue(f)),
    [open],
  );
  const timedOpen = React.useMemo(
    () => open.filter((f) => !isFollowupDeliveryIssue(f)),
    [open],
  );

  const overdue = React.useMemo(
    () =>
      timedOpen.filter(
        (f) => categorizeFollowupBucket(f.dueAt, viewDateYmd, timeZone) === "overdue",
      ),
    [timedOpen, viewDateYmd, timeZone],
  );
  const today = React.useMemo(
    () =>
      timedOpen.filter(
        (f) => categorizeFollowupBucket(f.dueAt, viewDateYmd, timeZone) === "today",
      ),
    [timedOpen, viewDateYmd, timeZone],
  );
  const thisWeek = React.useMemo(
    () =>
      timedOpen.filter(
        (f) => categorizeFollowupBucket(f.dueAt, viewDateYmd, timeZone) === "thisWeek",
      ),
    [timedOpen, viewDateYmd, timeZone],
  );
  const later = React.useMemo(
    () =>
      timedOpen.filter(
        (f) => categorizeFollowupBucket(f.dueAt, viewDateYmd, timeZone) === "later",
      ),
    [timedOpen, viewDateYmd, timeZone],
  );

  // KPI overdue includes failed sends that are also past due, so counts stay familiar.
  const overdueKpiCount = React.useMemo(
    () =>
      overdue.length +
      failed.filter((f) => categorizeFollowupBucket(f.dueAt, viewDateYmd, timeZone) === "overdue")
        .length,
    [overdue.length, failed, viewDateYmd, timeZone],
  );
  const todayKpiCount = React.useMemo(
    () =>
      today.length +
      failed.filter((f) => categorizeFollowupBucket(f.dueAt, viewDateYmd, timeZone) === "today")
        .length,
    [today.length, failed, viewDateYmd, timeZone],
  );

  React.useEffect(() => {
    setSelectedIds(new Set());
  }, [tab, bucketFilter, ownerScope, viewDateYmd, channelFilter]);

  React.useEffect(() => {
    setCompletedPageIndex(0);
  }, [ownerScope, tab, channelFilter, viewDateYmd]);

  React.useEffect(() => {
    setCompletedPageIndex((prev) => Math.min(prev, Math.max(0, completedTotalPages - 1)));
  }, [completedTotalPages]);

  const selectedFollowups = React.useMemo(
    () => open.filter((f) => selectedIds.has(f.id)),
    [open, selectedIds],
  );
  const selectedMutable = React.useMemo(
    () => selectedFollowups.filter((f) => canMutateRow(f)),
    [selectedFollowups, canMutateRow],
  );
  const selectedEmailMutable = React.useMemo(() => {
    return selectedMutable.filter((f) => isFollowupEmailChannel(f, followupLeadChannel(f)));
  }, [selectedMutable, followupLeadChannel]);
  const selectedNonEmailCount = selectedMutable.length - selectedEmailMutable.length;

  const sendableMailbox = React.useMemo(() => {
    const list = mailboxes.length > 0 ? mailboxes : [activeMailbox];
    const prefs = loadLastUsedMailboxPrefs(organizationId, currentUserId);
    const defaultId = resolveDefaultScheduleMailboxId({
      mailboxIds: list.map((mb) => mb.id),
      lastUsedId: prefs.lastMailboxId,
      activeMailboxId,
    });
    const picked = list.find((mb) => mb.id === defaultId) ?? list[0] ?? activeMailbox;
    if (isDemo) return picked;
    if (isEmailAccountConfigured(picked)) return picked;
    return list.find((mb) => isEmailAccountConfigured(mb)) ?? null;
  }, [mailboxes, activeMailbox, activeMailboxId, organizationId, currentUserId, isDemo]);

  function toggleBucket(next: BucketFilter) {
    setTab("open");
    setBucketFilter((prev) => (prev === next ? "all" : next));
  }

  function scrollToBucket(b: Exclude<BucketFilter, "all"> | "failed") {
    const id =
      b === "overdue"
        ? "followups-bucket-overdue"
        : b === "today"
          ? "followups-bucket-today"
          : b === "thisWeek"
            ? "followups-bucket-week"
            : b === "failed"
              ? "followups-bucket-failed"
              : "followups-bucket-week";
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleKpiOverdue() {
    toggleBucket("overdue");
    queueMicrotask(() => scrollToBucket("overdue"));
  }

  function handleKpiToday() {
    toggleBucket("today");
    queueMicrotask(() => scrollToBucket("today"));
  }

  function handleKpiThisWeek() {
    toggleBucket("thisWeek");
    queueMicrotask(() => scrollToBucket("thisWeek"));
  }

  function handleKpiCompleted() {
    setTab("completed");
    setBucketFilter("all");
  }

  const showGroup = (bucket: BucketFilter) => bucketFilter === "all" || bucketFilter === bucket;
  const showFailedGroup = bucketFilter === "all" || bucketFilter === "overdue" || bucketFilter === "today";

  function toggleSelect(id: string, selected: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleSelectAll(ids: string[], selected: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  const confirmDeleteFollowup = React.useCallback(async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    if (target.scheduledEmailId) {
      const result = await cancelScheduledEmailClient({
        scheduledEmailId: target.scheduledEmailId,
        isDemo,
        cancelDemo: cancelScheduled,
        followupId: target.id,
        selfUid: currentUserId,
        mailViewAsUid,
        activeMailboxDataOwnerUid: activeMailbox.dataOwnerUid,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      clearFollowupEmailSchedule(target.id);
    }
    removeFollowup(target.id);
    toast.success("Followup deleted");
  }, [
    deleteTarget,
    removeFollowup,
    isDemo,
    cancelScheduled,
    clearFollowupEmailSchedule,
    currentUserId,
    mailViewAsUid,
    activeMailbox.dataOwnerUid,
  ]);

  function handleUpdateFollowup(
    id: string,
    patch: Parameters<typeof updateFollowup>[1],
  ) {
    const existing = allFollowups.find((f) => f.id === id);
    const dueChanged =
      patch.dueAt !== undefined && existing != null && patch.dueAt !== existing.dueAt;
    const bodyChanged =
      patch.messageBody !== undefined &&
      existing != null &&
      (patch.messageBody || undefined) !== (existing.messageBody || undefined);
    if (existing?.scheduledEmailId && (dueChanged || bodyChanged)) {
      void (async () => {
        const result = await cancelScheduledEmailClient({
          scheduledEmailId: existing.scheduledEmailId!,
          isDemo,
          cancelDemo: cancelScheduled,
          followupId: id,
          selfUid: currentUserId,
          mailViewAsUid,
          activeMailboxDataOwnerUid: activeMailbox.dataOwnerUid,
        });
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        clearFollowupEmailSchedule(id);
        updateFollowup(id, patch);
      })();
      return;
    }
    updateFollowup(id, patch);
  }

  async function applyDueAtToFollowups(
    targets: Followup[],
    dueAt: string,
    onProgress?: (done: number, total: number) => void,
  ) {
    let ok = 0;
    let failedCount = 0;
    const total = targets.length;
    for (let i = 0; i < targets.length; i++) {
      const f = targets[i]!;
      try {
        if (!canMutateRow(f)) {
          failedCount += 1;
          continue;
        }
        if (f.scheduledEmailId) {
          const result = await cancelScheduledEmailClient({
            scheduledEmailId: f.scheduledEmailId,
            isDemo,
            cancelDemo: cancelScheduled,
            followupId: f.id,
            selfUid: currentUserId,
            mailViewAsUid,
            activeMailboxDataOwnerUid: activeMailbox.dataOwnerUid,
          });
          if ("error" in result) {
            failedCount += 1;
            continue;
          }
          clearFollowupEmailSchedule(f.id);
        }
        updateFollowup(f.id, { dueAt });
        ok += 1;
      } finally {
        onProgress?.(i + 1, total);
      }
    }
    if (ok > 0) {
      toast.success(
        ok === 1 ? "Followup rescheduled" : `${ok} followups rescheduled`,
      );
    }
    if (failedCount > 0) {
      toast.error(
        failedCount === 1
          ? "Could not reschedule 1 followup"
          : `Could not reschedule ${failedCount} followups`,
      );
    }
    setSelectedIds(new Set());
  }

  async function tryNowFollowups(
    targets: Followup[],
    onProgress?: (done: number, total: number) => void,
  ) {
    let scheduled = 0;
    let retried = 0;
    let bumped = 0;
    let skipped = 0;
    let scheduleIndex = 0;
    const now = Date.now();
    const total = targets.length;

    for (let i = 0; i < targets.length; i++) {
      const raw = targets[i]!;
      try {
        if (!canMutateRow(raw)) {
          skipped += 1;
          continue;
        }
        const f = await hydrateFollowupMessageBody(raw);
        const lead = f.leadId ? ws.getLeadById(f.leadId) : undefined;
        const plan = planFollowupTryNow(f, lead?.channel);

        if (plan.kind === "retry") {
          if (!f.scheduledEmailId) {
            skipped += 1;
            continue;
          }
          const result = await retryScheduledEmailClient({
            scheduledEmailId: f.scheduledEmailId,
            isDemo,
            selfUid: currentUserId,
            mailViewAsUid,
            activeMailboxDataOwnerUid: activeMailbox.dataOwnerUid,
            retryDemo: (id) => {
              setScheduled(
                scheduledEmails.map((s) =>
                  s.id === id
                    ? {
                        ...s,
                        status: "pending" as const,
                        scheduledAt: new Date(Date.now() + 60_000).toISOString(),
                        error: undefined,
                      }
                    : s,
                ),
              );
            },
          });
          if ("error" in result) {
            skipped += 1;
            continue;
          }
          if (result.scheduledAt) {
            setFollowupEmailSchedule(f.id, {
              scheduledEmailId: f.scheduledEmailId,
              emailScheduledAt: result.scheduledAt,
              ...(f.mailboxId ? { mailboxId: f.mailboxId } : {}),
              ...(f.fromEmail ? { fromEmail: f.fromEmail } : {}),
              ...(f.toEmail ? { toEmail: f.toEmail } : {}),
              ...(f.mailboxOwnerUid ? { mailboxOwnerUid: f.mailboxOwnerUid } : {}),
            });
            updateFollowup(f.id, { dueAt: result.scheduledAt });
          }
          retried += 1;
          continue;
        }

        if (plan.kind === "schedule") {
          if (!lead || !sendableMailbox) {
            // Fall back to due bump when we cannot send.
            const dueAt = tryNowDueAtIso(now);
            if (f.scheduledEmailId) {
              const cancel = await cancelScheduledEmailClient({
                scheduledEmailId: f.scheduledEmailId,
                isDemo,
                cancelDemo: cancelScheduled,
                followupId: f.id,
                selfUid: currentUserId,
                mailViewAsUid,
                activeMailboxDataOwnerUid: activeMailbox.dataOwnerUid,
              });
              if ("error" in cancel) {
                skipped += 1;
                continue;
              }
              clearFollowupEmailSchedule(f.id);
            }
            updateFollowup(f.id, { dueAt });
            bumped += 1;
            continue;
          }

          const contact = getContactById(lead.contactId);
          const recipientOptions = buildContactRecipientOptions(lead, contact);
          const rememberedTo = f.toEmail?.trim();
          const to =
            rememberedTo &&
            recipientOptions.some((o) => o.email.toLowerCase() === rememberedTo.toLowerCase())
              ? rememberedTo
              : defaultContactRecipientEmail(recipientOptions);
          if (!to) {
            skipped += 1;
            continue;
          }

          if (plan.requeue && f.scheduledEmailId) {
            const cancel = await cancelScheduledEmailClient({
              scheduledEmailId: f.scheduledEmailId,
              isDemo,
              cancelDemo: cancelScheduled,
              followupId: f.id,
              selfUid: currentUserId,
              mailViewAsUid,
              activeMailboxDataOwnerUid: activeMailbox.dataOwnerUid,
            });
            if ("error" in cancel) {
              skipped += 1;
              continue;
            }
            clearFollowupEmailSchedule(f.id);
          }

          const scheduledAtIso = tryNowScheduleAtIso(scheduleIndex, now);
          scheduleIndex += 1;
          const result = await scheduleFollowupEmailClient({
            followupId: f.id,
            leadId: lead.id,
            mailbox: sendableMailbox,
            to,
            subject: f.emailSubject?.trim() || f.title,
            body: f.messageBody ?? "",
            includeSignature: true,
            globalEmailFooter,
            includeFooter: true,
            scheduledAtIso,
            isDemo,
            addDemoScheduled: addScheduled,
          });
          if (!result.ok) {
            skipped += 1;
            continue;
          }
          setFollowupEmailSchedule(f.id, {
            scheduledEmailId: result.scheduledEmailId,
            emailScheduledAt: result.emailScheduledAt,
            ...followupScheduleMailboxFields(sendableMailbox, to),
          });
          updateFollowup(f.id, { dueAt: result.emailScheduledAt });
          rememberLastUsedMailbox(organizationId, currentUserId, sendableMailbox.id);
          scheduled += 1;
          continue;
        }

        // bump_due
        if (f.scheduledEmailId) {
          const cancel = await cancelScheduledEmailClient({
            scheduledEmailId: f.scheduledEmailId,
            isDemo,
            cancelDemo: cancelScheduled,
            followupId: f.id,
            selfUid: currentUserId,
            mailViewAsUid,
            activeMailboxDataOwnerUid: activeMailbox.dataOwnerUid,
          });
          if ("error" in cancel) {
            skipped += 1;
            continue;
          }
          clearFollowupEmailSchedule(f.id);
        }
        updateFollowup(f.id, { dueAt: tryNowDueAtIso(now) });
        bumped += 1;
      } finally {
        onProgress?.(i + 1, total);
      }
    }

    const parts: string[] = [];
    if (scheduled > 0) parts.push(`${scheduled} queued to send`);
    if (retried > 0) parts.push(`${retried} retried`);
    if (bumped > 0) parts.push(`${bumped} due now`);
    if (parts.length > 0) {
      toast.success(parts.join(" · "));
    }
    if (skipped > 0) {
      toast.error(
        skipped === 1
          ? "Could not try 1 followup"
          : `Could not try ${skipped} followups`,
      );
    }
    setSelectedIds(new Set());
  }

  async function handleBulkMarkDone() {
    if (selectedMutable.length === 0) return;
    const targets = selectedMutable;
    const total = targets.length;
    const showProgress = total > 1;
    setBulkBusy(true);
    if (showProgress) {
      setBulkProgress({
        title: "Marking followups done",
        statusLabel: "Updating…",
        done: 0,
        total,
      });
    }
    try {
      for (let i = 0; i < targets.length; i++) {
        setFollowupCompleted(targets[i]!.id, true);
        if (showProgress) {
          setBulkProgress({
            title: "Marking followups done",
            statusLabel: i + 1 >= total ? "Finishing…" : "Updating…",
            done: i + 1,
            total,
          });
          if (i % 8 === 7) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
        }
      }
      toast.success(
        total === 1 ? "Marked complete" : `${total} marked complete`,
      );
      setSelectedIds(new Set());
    } finally {
      setBulkBusy(false);
      setBulkProgress(null);
    }
  }

  function requestBulkTryNow() {
    if (selectedEmailMutable.length === 0) {
      toast.error(
        selectedMutable.length > 0
          ? "No email followups in selection. LinkedIn and other channels are skipped."
          : "Nothing selected that you can update.",
      );
      return;
    }
    setRetryConfirmOpen(true);
  }

  async function confirmBulkTryNow() {
    const targets = selectedEmailMutable;
    const total = targets.length;
    const skipped = selectedNonEmailCount;
    setRetryConfirmOpen(false);
    setBulkBusy(true);
    setBulkProgress({
      title:
        total === 1 ? "Trying email followup" : `Trying ${total} email followups`,
      statusLabel:
        skipped > 0
          ? `Queuing emails… (${skipped} LinkedIn/other skipped)`
          : "Queuing emails…",
      done: 0,
      total,
    });
    try {
      await tryNowFollowups(targets, (done, t) => {
        setBulkProgress({
          title:
            t === 1 ? "Trying email followup" : `Trying ${t} email followups`,
          statusLabel:
            done >= t
              ? "Finishing…"
              : skipped > 0
                ? `Queuing emails… (${skipped} LinkedIn/other skipped)`
                : "Queuing emails…",
          done,
          total: t,
        });
      });
    } finally {
      setBulkBusy(false);
      setBulkProgress(null);
    }
  }

  async function handleBulkReschedule(dueAt: string) {
    const targets = selectedEmailMutable;
    const total = targets.length;
    const skipped = selectedNonEmailCount;
    if (total === 0) return;
    setBulkBusy(true);
    setBulkProgress({
      title:
        total === 1
          ? "Rescheduling email followup"
          : `Rescheduling ${total} email followups`,
      statusLabel:
        skipped > 0
          ? `Updating due dates… (${skipped} LinkedIn/other skipped)`
          : "Updating due dates…",
      done: 0,
      total,
    });
    try {
      await applyDueAtToFollowups(targets, dueAt, (done, t) => {
        setBulkProgress({
          title:
            t === 1
              ? "Rescheduling email followup"
              : `Rescheduling ${t} email followups`,
          statusLabel:
            done >= t
              ? "Finishing…"
              : skipped > 0
                ? `Updating due dates… (${skipped} LinkedIn/other skipped)`
                : "Updating due dates…",
          done,
          total: t,
        });
      });
    } finally {
      setBulkBusy(false);
      setBulkProgress(null);
    }
  }

  function requestBulkReschedule() {
    if (selectedEmailMutable.length === 0) {
      toast.error(
        selectedMutable.length > 0
          ? "No email followups in selection. LinkedIn and other channels are skipped."
          : "Nothing selected that you can update.",
      );
      return;
    }
    setRescheduleOpen(true);
  }

  async function handleSingleTryNow(f: Followup) {
    if (!canMutateRow(f)) {
      toast.error("You cannot update this followup.");
      return;
    }
    setBulkBusy(true);
    try {
      await tryNowFollowups([f]);
    } finally {
      setBulkBusy(false);
    }
  }

  function handleSingleReschedule(f: Followup) {
    setSelectedIds(new Set([f.id]));
    setRescheduleOpen(true);
  }

  function handleRequestEdit(f: Followup) {
    void (async () => {
      const hydrated = await hydrateFollowupMessageBody(f);
      setEditTarget(hydrated);
    })();
  }

  const groupProps = {
    getLeadById: ws.getLeadById,
    onToggleComplete: setFollowupCompleted,
    onRowNavigate: (leadId: string) => router.push(`/leads/${leadId}`),
    canMutate: canMutateRow,
    onRequestDelete: setDeleteTarget,
    onRequestEdit: handleRequestEdit,
    selectedIds,
    onToggleSelect: toggleSelect,
    onToggleSelectAll: toggleSelectAll,
    timeZone,
    isViewToday,
    onRequestTryNow: handleSingleTryNow,
    onRequestReschedule: handleSingleReschedule,
    busy: bulkBusy,
    pageSize,
    onPageSizeChange: handlePageSizeChange,
  };

  return (
    <>
      <PageHeader
        title="Followups"
        description="Reminders for leads you can access in this workspace, filter by assignee and agenda date."
        actions={
          <Button size="sm" type="button" onClick={() => setDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New followup
          </Button>
        }
      />
      <PageBody className={cn(selectedIds.size > 0 && tab === "open" && "pb-24")}>
        {!followupsReady ? (
          <WorkspacePageSkeleton />
        ) : !isDemo && allFollowups.length === 0 ? (
          <WorkspaceEmptyHint title="No followups in workspace" />
        ) : (
          <>
            <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Agenda date
                </p>
                <p className="text-lg font-semibold leading-tight">{format(anchorDay, "EEEE, MMMM d, yyyy")}</p>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                  {!isViewToday ? (
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-xs text-muted-foreground"
                      onClick={() => setViewDateYmd(todayYmd)}
                    >
                      Jump to today
                    </Button>
                  ) : null}
                  <p className="text-xs text-muted-foreground max-w-xl">
                    Buckets use this calendar day and the week that contains it. Owner matches followup
                    assignee (often the lead owner). Except for director / org-wide roles, you only see
                    followups linked to leads you can already open.
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="followups-view-date" className="text-xs text-muted-foreground">
                    Date
                  </Label>
                  <Input
                    id="followups-view-date"
                    type="date"
                    className="h-9 w-[11.5rem] bg-background"
                    value={viewDateYmd}
                    onChange={(e) => setViewDateYmd(e.target.value || todayYmd)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">Channel</Label>
                  <Tabs value={channelFilter} onValueChange={handleChannelFilterChange}>
                    <TabsList>
                      <TabsTrigger value="all">
                        All
                        <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                          {channelOpenCounts.all}
                        </Badge>
                      </TabsTrigger>
                      <TabsTrigger value="email">
                        <Mail className="h-3.5 w-3.5" />
                        Email
                        <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                          {channelOpenCounts.email}
                        </Badge>
                      </TabsTrigger>
                      <TabsTrigger value="linkedin">
                        <Network className="h-3.5 w-3.5" />
                        LinkedIn
                        <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                          {channelOpenCounts.linkedin}
                        </Badge>
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                <div className="grid min-w-0 gap-1.5 sm:min-w-[11rem]">
                  <Label className="text-xs text-muted-foreground">Owner</Label>
                  <Select value={ownerScope} onValueChange={(v) => setOwnerScope(v ?? "all-owners")}>
                    <SelectTrigger size="sm" className="min-w-0 max-w-full gap-1.5">
                      <Users className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                      <SelectValue placeholder="Owner">{ownerFilterTriggerLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectGroup>
                        <SelectLabel className="text-[10px] uppercase tracking-wide">Quick</SelectLabel>
                        <SelectItem value="all-owners">All owners</SelectItem>
                        <SelectItem value="me">Owned by me</SelectItem>
                        <SelectItem value="team">My team</SelectItem>
                        <SelectItem value="open-queue">Open queue</SelectItem>
                        <SelectItem value="unassigned">Orphan owner</SelectItem>
                      </SelectGroup>
                      {ownerPickerOptions.length > 0 ? (
                        <>
                          <SelectSeparator />
                          <SelectGroup>
                            <SelectLabel className="text-[10px] uppercase tracking-wide">By teammate</SelectLabel>
                            {ownerPickerOptions.map((o) => (
                              <SelectItem key={o.id} value={`${OWNER_SCOPE_PREFIX}${o.id}`}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </>
                      ) : null}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {allFollowups.length > 0 && followups.length === 0 ? (
              <p className="mb-4 text-sm text-muted-foreground">
                No followups match this owner filter. Try &ldquo;All owners&rdquo; or pick a teammate.
              </p>
            ) : followups.length > 0 && open.length === 0 && done.length === 0 && channelFilter !== "all" ? (
              <p className="mb-4 text-sm text-muted-foreground">
                No {channelFilter === "email" ? "email" : "LinkedIn"} followups match the current filters.
                Try the All channel tab.
              </p>
            ) : null}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard
                label="Overdue"
                value={overdueKpiCount}
                icon={AlertTriangle}
                onClick={handleKpiOverdue}
                selected={tab === "open" && bucketFilter === "overdue"}
              />
              <KpiCard
                label={dueAnchorKpiLabel}
                value={todayKpiCount}
                icon={Clock}
                onClick={handleKpiToday}
                selected={tab === "open" && bucketFilter === "today"}
              />
              <KpiCard
                label="This week"
                value={thisWeek.length}
                icon={CalendarClock}
                onClick={handleKpiThisWeek}
                selected={tab === "open" && bucketFilter === "thisWeek"}
              />
              <KpiCard
                label="Completed"
                value={done.length}
                icon={CheckCircle2}
                onClick={handleKpiCompleted}
                selected={tab === "completed"}
              />
            </div>

            <Tabs
              value={tab}
              onValueChange={(v) => {
                const next = v as "open" | "completed";
                setTab(next);
                if (next === "completed") setBucketFilter("all");
              }}
              className="mt-4"
            >
              <TabsList>
                <TabsTrigger value="open">
                  Open
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {open.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="completed">
                  Completed
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {done.length}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="open" className="mt-4 space-y-4">
                {bucketFilter !== "all" && (
                  <p className="text-xs text-muted-foreground">
                    Showing{" "}
                    {bucketFilter === "overdue"
                      ? "overdue"
                      : bucketFilter === "today"
                        ? isViewToday
                          ? "due today"
                          : `due on ${format(anchorDay, "MMM d")}`
                        : "this week"}{" "}
                    only (for {format(anchorDay, "MMM d, yyyy")}). Click the same summary card again to show all
                    open followups.
                  </p>
                )}
                {(() => {
                  if (!showFailedGroup || failed.length === 0) return null;
                  const failedItems =
                    bucketFilter === "overdue"
                      ? failed.filter(
                          (f) =>
                            categorizeFollowupBucket(f.dueAt, viewDateYmd, timeZone) === "overdue",
                        )
                      : bucketFilter === "today"
                        ? failed.filter(
                            (f) =>
                              categorizeFollowupBucket(f.dueAt, viewDateYmd, timeZone) === "today",
                          )
                        : failed;
                  if (failedItems.length === 0) return null;
                  return (
                    <div id="followups-bucket-failed">
                      <FollowupGroup
                        key={`failed-${channelFilter}-${ownerScope}-${viewDateYmd}`}
                        title="Failed sends"
                        description="Delivery failed or waiting for retry."
                        tone="rose"
                        bucket="failed"
                        items={failedItems}
                        empty={emptyBucketCopy(
                          channelFilter,
                          "No failed sends.",
                          "No failed email sends.",
                          "No failed LinkedIn followups.",
                        )}
                        {...groupProps}
                      />
                    </div>
                  );
                })()}
                {showGroup("overdue") && (
                  <div id="followups-bucket-overdue">
                    <FollowupGroup
                      key={`overdue-${channelFilter}-${ownerScope}-${viewDateYmd}`}
                      title="Overdue"
                      description="Past due (highest priority)."
                      tone="rose"
                      bucket="overdue"
                      items={overdue}
                      empty={emptyBucketCopy(
                        channelFilter,
                        "Nothing overdue. Nice.",
                        "No overdue email followups.",
                        "No overdue LinkedIn followups.",
                      )}
                      {...groupProps}
                    />
                  </div>
                )}
                {showGroup("today") && (
                  <div id="followups-bucket-today">
                    <FollowupGroup
                      key={`today-${channelFilter}-${ownerScope}-${viewDateYmd}`}
                      title={dueAnchorBucketTitle}
                      description={
                        isViewToday
                          ? "Let's knock these out today."
                          : `Scheduled on ${format(anchorDay, "MMMM d, yyyy")}.`
                      }
                      tone="amber"
                      bucket="today"
                      items={today}
                      empty={
                        channelFilter === "email"
                          ? isViewToday
                            ? "No email followups due today."
                            : `No email followups due on ${format(anchorDay, "MMM d")}.`
                          : channelFilter === "linkedin"
                            ? isViewToday
                              ? "No LinkedIn followups due today."
                              : `No LinkedIn followups due on ${format(anchorDay, "MMM d")}.`
                            : isViewToday
                              ? "Nothing due today."
                              : `Nothing due on ${format(anchorDay, "MMM d")}.`
                      }
                      {...groupProps}
                    />
                  </div>
                )}
                {showGroup("thisWeek") && (
                  <div id="followups-bucket-week">
                    <FollowupGroup
                      key={`week-${channelFilter}-${ownerScope}-${viewDateYmd}`}
                      title="This week"
                      description="Coming up in the next 7 days."
                      tone="neutral"
                      bucket="thisWeek"
                      items={thisWeek}
                      empty={emptyBucketCopy(
                        channelFilter,
                        "No followups this week.",
                        "No email followups this week.",
                        "No LinkedIn followups this week.",
                      )}
                      {...groupProps}
                    />
                  </div>
                )}
                {bucketFilter === "all" && (
                  <div id="followups-bucket-later">
                    <FollowupGroup
                      key={`later-${channelFilter}-${ownerScope}-${viewDateYmd}`}
                      title="Later"
                      description="Scheduled further out."
                      tone="neutral"
                      bucket="later"
                      items={later}
                      empty={emptyBucketCopy(
                        channelFilter,
                        "Nothing scheduled further out.",
                        "No email followups scheduled further out.",
                        "No LinkedIn followups scheduled further out.",
                      )}
                      {...groupProps}
                    />
                  </div>
                )}
              </TabsContent>

              <TabsContent value="completed" className="mt-4">
                <Card>
                  <CardContent className="p-0 divide-y">
                    {doneVisible.map((f) => {
                      const lead = f.leadId ? ws.getLeadById(f.leadId) : undefined;
                      return (
                        <div
                          key={f.id}
                          role={lead ? "button" : undefined}
                          tabIndex={lead ? 0 : undefined}
                          className={cn(
                            "flex items-center gap-3 px-4 py-2 opacity-90",
                            lead && "cursor-pointer hover:bg-muted/50",
                          )}
                          onClick={(e) => {
                            if (
                              (e.target as HTMLElement).closest(
                                "[data-slot=checkbox], [data-followup-delete], [data-followup-edit]",
                              )
                            )
                              return;
                            if (lead) router.push(`/leads/${lead.id}`);
                          }}
                          onKeyDown={(e) => {
                            if (!lead) return;
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              router.push(`/leads/${lead.id}`);
                            }
                          }}
                        >
                          <Checkbox
                            checked
                            onCheckedChange={(v) => {
                              if (v !== true) setFollowupCompleted(f.id, false);
                            }}
                            aria-label={`Mark ${f.title} as not done`}
                          />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm line-through truncate block">{f.title}</span>
                            {lead && (
                              <Link
                                href={`/leads/${lead.id}`}
                                className="text-xs text-muted-foreground hover:text-primary truncate block mt-0.5"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {lead.contactName} · {lead.companyName}
                              </Link>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {fmtRelative(f.completedAt)}
                          </span>
                          {canMutateRow(f) ? (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0 text-muted-foreground"
                                data-followup-edit
                                aria-label="Edit followup"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRequestEdit(f);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                                data-followup-delete
                                aria-label="Delete followup"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteTarget(f);
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : null}
                        </div>
                      );
                    })}
                    {done.length === 0 && (
                      <div className="p-6 text-center text-sm text-muted-foreground">
                        {emptyBucketCopy(
                          channelFilter,
                          "Nothing completed yet.",
                          "No completed email followups.",
                          "No completed LinkedIn followups.",
                        )}
                      </div>
                    )}
                    {done.length > 0 ? (
                      <div className="px-4 pb-3">
                        <ListPaginationBar
                          total={done.length}
                          pageIndex={safeCompletedPageIndex}
                          pageSize={pageSize}
                          onPageIndexChange={setCompletedPageIndex}
                          onPageSizeChange={handlePageSizeChange}
                          itemLabel={done.length === 1 ? "followup" : "followups"}
                        />
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </PageBody>

      {selectedIds.size > 0 && tab === "open" ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 shadow-lg backdrop-blur supports-backdrop-filter:bg-background/90">
            <span className="text-sm font-medium tabular-nums whitespace-nowrap">
              {selectedIds.size} selected
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              disabled={bulkBusy || selectedMutable.length === 0}
              onClick={requestBulkTryNow}
            >
              {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Try now
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              disabled={bulkBusy || selectedMutable.length === 0}
              onClick={requestBulkReschedule}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              Reschedule
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8"
              disabled={bulkBusy || selectedMutable.length === 0}
              onClick={() => void handleBulkMarkDone()}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Mark done
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8"
              disabled={bulkBusy}
              onClick={() => setSelectedIds(new Set())}
              aria-label="Clear selection"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      <BulkFollowupProgressDialog progress={bulkProgress} />

      <AlertDialog open={deleteTarget != null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this followup?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the reminder for everyone in the workspace. Linked lead activity is not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void confirmDeleteFollowup()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={retryConfirmOpen} onOpenChange={setRetryConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Try {selectedEmailMutable.length === 1
                ? "1 email followup"
                : `${selectedEmailMutable.length} email followups`}{" "}
              now?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Only email steps will be queued or retried
              {selectedNonEmailCount > 0
                ? ` (${selectedNonEmailCount} LinkedIn/other skipped)`
                : ""}
              . Email-ready steps send shortly (staggered). Failed sends are retried. Large batches
              may hit daily send limits.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={bulkBusy} onClick={() => void confirmBulkTryNow()}>
              Try now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {dialogOpen ? (
        <NewFollowupDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          leads={leads}
          currentUserId={currentUserId}
          onCreate={addFollowup}
        />
      ) : null}

      {editTarget ? (
        <NewFollowupDialog
          open
          onOpenChange={(o) => {
            if (!o) setEditTarget(null);
          }}
          leads={leads}
          currentUserId={currentUserId}
          editFollowup={editTarget}
          onUpdate={(id, patch) => {
            handleUpdateFollowup(id, patch);
          }}
        />
      ) : null}

      {rescheduleOpen ? (
        <RescheduleFollowupsDialog
          open={rescheduleOpen}
          onOpenChange={setRescheduleOpen}
          count={selectedEmailMutable.length}
          skippedNonEmailCount={selectedNonEmailCount}
          timeZone={timeZone}
          referenceDueAt={selectedEmailMutable[0]?.dueAt ?? selectedMutable[0]?.dueAt}
          onConfirm={handleBulkReschedule}
        />
      ) : null}
    </>
  );
}
