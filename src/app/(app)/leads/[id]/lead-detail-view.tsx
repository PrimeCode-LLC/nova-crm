"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Building2,
  Mail,
  Phone,
  Link as LinkIcon,
  MapPin,
  Sparkles,
  ArrowLeft,
  Pencil,
  Share2,
  Star,
  MoreHorizontal,
  Trash2,
  UserPlus,
  Copy,
  ShieldAlert,
  ShieldCheck,
  ListTodo,
  Loader2,
  MailWarning,
  Undo2,
} from "lucide-react";

import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import {
  createUserNotifications,
} from "@/lib/notifications/create-user-notification";
import { buildOwnershipHandoffNotifications } from "@/lib/notifications/ownership-handoff";
import {
  CHANNELS_REQUIRING_OUTREACH_PROFILE,
  outreachProfileFieldLabel,
  PIPELINE_STAGES,
  REVENUE_RANGES,
  STAGES_BY_KEY,
  INTAKE_KIND_META,
} from "@/lib/constants";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { STAGE_TONE_CLASS, StageBadge } from "@/components/common/stage-badge";
import { ChannelTagsRow } from "@/components/common/channel-tags-row";
import { channelLabelFromValue } from "@/lib/channel-options";
import { buildChannelTagTooltipMap } from "@/lib/prospects/channel-tag-display";
import { useChannelOptions } from "@/hooks/use-channel-options";
import { UserChip } from "@/components/common/user-chip";
import { LeadTimeline } from "@/components/leads/lead-timeline";
import { LeadOverview } from "@/components/leads/lead-overview";
import { LeadTouchpoints } from "@/components/leads/lead-touchpoints";
import { LeadNotes } from "@/components/leads/lead-notes";
import { LeadFollowups } from "@/components/leads/lead-followups";
import { LeadReplyReviewBanner } from "@/components/leads/lead-reply-review-banner";
import { LeadContactEmailActionBanner } from "@/components/leads/lead-contact-email-action-banner";
import { UpdateContactEmailDialog } from "@/components/leads/update-contact-email-dialog";
import { leadHasLinkedIn } from "@/lib/email/bounce-recovery";
import { rerouteFollowupSequenceClient } from "@/lib/email/reroute-followup-sequence-client";
import { cancelScheduledEmailClient } from "@/lib/cancel-followup-scheduled-email-client";
import {
  getPausedFollowupPlanForLead,
  mergeFollowupPlans,
} from "@/lib/followup-plans";
import {
  getActiveMailbox,
} from "@/stores/email-account-store";
import { SuggestFollowupsDialog } from "@/components/ai/suggest-followups-dialog";
import { LeadSchedulingPanel } from "@/components/scheduling/lead-scheduling-panel";
import { LeadTasksPanel } from "@/components/leads/lead-tasks";
import { LeadEmailsPanel } from "@/components/leads/lead-emails-panel";
import { LeadQualityBadge } from "@/components/leads/lead-quality-badge";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { fmtCurrency, fmtDate, fmtRelative, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  buildEmailChangeTimelineEvents,
  contactHasBouncedEmail,
  contactPatchClearingBounce,
  diffContactEmailChanges,
  openBounceReviewTasksForLead,
} from "@/lib/email/contact-email-change";
import {
  emailVerificationBadgeClass,
  emailVerificationDescription,
  emailVerificationLabel,
  resolveEmailVerificationStatus,
  shouldOfferEmailVerify,
} from "@/lib/email/email-verification-status";
import {
  formatVerifySummary,
  verifyLeadEmailsClient,
} from "@/lib/integrations/millionverifier/verify-client";
import { findSuggestedNewEmailFromMessages } from "@/lib/email/extract-suggested-new-email";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EditLeadDialog, type LeadEditSection } from "@/components/leads/edit-lead-dialog";
import { LeadSourceButton, LeadScraperSourceSummary } from "@/components/leads/lead-source-button";
import { ProspectChannelPanel } from "@/components/prospects/prospect-channel-panel";
import { ProspectIntakeDialog } from "@/components/leads/prospect-intake-dialog";
import { LeadAnalyzeDialog } from "@/components/ai/lead-analyze-dialog";
import type { Lead, OrganizationMember, PipelineStage, User } from "@/lib/types";
import { filterLeadTasksForLeadDetail, workspaceViewerForLeadTasks } from "@/lib/lead-task-visibility";
import { useEmailAccountStore } from "@/stores/email-account-store";
import { useLeadEmailResponseContext } from "@/hooks/use-lead-email-response-context";
import { canAction } from "@/lib/permissions/can";
import { roleAtLeast } from "@/lib/platform/org-role";
import {
  moveBackBlockedReason,
  moveBackConfirmCopy,
  moveBackModeFor,
  type MoveBackActivity,
} from "@/lib/prospects/move-back-to-prospect";
import { prospectOwnerIdOf } from "@/lib/prospects/prospect-access";
import { Checkbox } from "@/components/ui/checkbox";
import { resolveLeadResponseTimeMinutes } from "@/lib/email/lead-response-time";
import { extractEmailAddresses } from "@/lib/email/reply-compose";
import {
  buildWorkspaceOwnerPickerOptions,
  ownerPickerTriggerLabel,
} from "@/lib/owner-scope";
import { useProspectingStrategyData } from "@/lib/hooks/use-prospecting-strategy-data";

const LEAD_TABS = ["overview", "timeline", "touchpoints", "notes", "followups", "tasks", "emails"] as const;
type LeadTab = (typeof LEAD_TABS)[number];
const OPEN_QUEUE_OWNER_VALUE = "__open_queue__";

type OwnerOption = { id: string; label: string };

/** Org membership is authoritative for disabled teammates; CRM `users` alone can still list them. */
function activeOrgMemberOwnerOptions(members: OrganizationMember[], crmUsers: User[]): OwnerOption[] {
  const uidToUser = new Map(crmUsers.map((u) => [u.id, u]));
  const opts: OwnerOption[] = [];
  for (const m of members) {
    if (m.status !== "active") continue;
    const u = uidToUser.get(m.uid);
    if (u?.status === "inactive") continue;
    const label =
      m.displayName?.trim() ||
      u?.displayName?.trim() ||
      (m.email.includes("@") ? m.email.split("@")[0] : m.email) ||
      u?.email.split("@")[0] ||
      m.uid;
    opts.push({ id: m.uid, label });
  }
  opts.sort((a, b) => a.label.localeCompare(b.label));
  return opts;
}

function tabFromSearchParams(searchParams: ReturnType<typeof useSearchParams>): LeadTab {
  const raw = searchParams.get("tab");
  if (raw && (LEAD_TABS as readonly string[]).includes(raw)) {
    return raw as LeadTab;
  }
  return "overview";
}

export function LeadDetailView({ leadId }: { leadId: string }) {
  const ws = useWorkspace();
  const prospecting = useProspectingStrategyData();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabFromUrl = React.useMemo(() => tabFromSearchParams(searchParams), [searchParams]);
  const activeTab = tabFromUrl;
  const [editingSection, setEditingSection] = React.useState<LeadEditSection | null>(null);
  const [prospectFieldsSection, setProspectFieldsSection] = React.useState<
    "all" | "company" | "contact" | null
  >(null);
  const [updateEmailOpen, setUpdateEmailOpen] = React.useState(false);
  const [updateEmailReason, setUpdateEmailReason] = React.useState<"bounce" | "suggested" | "manual">(
    "manual",
  );
  const [updateEmailSuggested, setUpdateEmailSuggested] = React.useState<string | undefined>();
  const [verifyingEmail, setVerifyingEmail] = React.useState(false);
  const [linkedinSuggestOpen, setLinkedinSuggestOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [moveBackOpen, setMoveBackOpen] = React.useState(false);
  const [moveBackBusy, setMoveBackBusy] = React.useState(false);
  const [moveBackAck, setMoveBackAck] = React.useState(false);
  const [analyzeOpen, setAnalyzeOpen] = React.useState(false);
  const [aiInsights, setAiInsights] = React.useState<{
    summary: string;
    riskLevel: string;
  } | null>(null);
  const onTabChange = React.useCallback(
    (v: string) => {
      const t = v as LeadTab;
      const p = new URLSearchParams(searchParams.toString());
      p.set("tab", t);
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const backFrom = searchParams.get("from");
  const lead = ws.getLeadById(leadId);
  const backHref =
    backFrom === "pipeline"
      ? "/pipeline"
      : backFrom === "prospects" || lead?.intakeKind === "prospect"
        ? "/prospects"
        : "/leads";
  const backLabel =
    backHref === "/pipeline"
      ? "Back to pipeline"
      : backHref === "/prospects"
        ? "Back to prospects"
        : "Back to leads";
  const channelOptions = useChannelOptions({ includeDisabled: true });
  const channelTagTooltips = React.useMemo(() => {
    if (!lead) return undefined;
    return buildChannelTagTooltipMap(
      lead,
      ws.leads,
      ws.getOwnerDisplayName,
      (ch) => channelLabelFromValue(ch, channelOptions) || ch,
    );
  }, [lead, ws.leads, ws.getOwnerDisplayName, channelOptions]);

  const viewerForTasks = React.useMemo(
    () => workspaceViewerForLeadTasks(ws.getUserById, ws.currentUserId),
    [ws.currentUserId, ws.getUserById],
  );
  const leadTasksForTab = React.useMemo(
    () => filterLeadTasksForLeadDetail(ws.leadTasks, leadId, viewerForTasks),
    [ws.leadTasks, leadId, viewerForTasks],
  );
  const inboundByMailbox = useEmailAccountStore((s) => s.inboundByMailbox);
  const sent = useEmailAccountStore((s) => s.sent);
  const linkedLeadByMessageId = useEmailAccountStore((s) => s.linkedLeadByMessageId);
  const emailResponseCtx = useLeadEmailResponseContext();
  const responseTimeMinutes = lead ? resolveLeadResponseTimeMinutes(lead, emailResponseCtx) : null;

  const touchpoints = React.useMemo(
    () => (lead ? ws.touchpoints.filter((t) => t.leadId === lead.id) : []),
    [lead, ws.touchpoints],
  );
  const timeline = React.useMemo(
    () => (lead ? (ws.timelineByLead[lead.id] ?? []) : []),
    [lead, ws.timelineByLead],
  );
  const notes = React.useMemo(
    () => (lead ? ws.notes.filter((n) => n.leadId === lead.id) : []),
    [lead, ws.notes],
  );
  const followups = React.useMemo(
    () => (lead ? ws.followups.filter((f) => f.leadId === lead.id) : []),
    [lead, ws.followups],
  );
  const notesTabCount = React.useMemo(
    () => notes.length + (lead?.notes?.trim() ? 1 : 0),
    [lead?.notes, notes.length],
  );
  const relatedEmailAddress = lead
    ? ws.getContactById(lead.contactId)?.email || lead.contactEmail || ""
    : "";
  const relatedPersonalEmail = lead
    ? ws.getContactById(lead.contactId)?.personalEmail || ""
    : "";
  const relatedEmails = React.useMemo(() => {
    if (!lead) return [];
    const known = new Set(
      [relatedEmailAddress, relatedPersonalEmail]
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    );
    const rows: { id: string; subject: string; at: string; from: string; to: string; body: string }[] = [];
    for (const [mailboxId, messages] of Object.entries(inboundByMailbox)) {
      for (const m of messages) {
        const mid = `${mailboxId}:in:${m.id}`;
        const manual = linkedLeadByMessageId[mid] === lead.id;
        const addrs = extractEmailAddresses(m.from, m.to, m.cc);
        const auto = [...known].some((e) => addrs.has(e));
        if (!manual && !auto) continue;
        rows.push({ id: mid, subject: m.subject, at: m.date, from: m.from, to: m.to, body: m.bodyText });
      }
    }
    for (const m of sent) {
      const manual = linkedLeadByMessageId[m.id] === lead.id;
      const addrs = extractEmailAddresses(m.from, m.to, m.cc);
      const auto = [...known].some((e) => addrs.has(e));
      if (!manual && !auto) continue;
      rows.push({ id: m.id, subject: m.subject, at: m.sentAt, from: m.from, to: m.to, body: m.body });
    }
    return rows.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [inboundByMailbox, linkedLeadByMessageId, lead, relatedEmailAddress, relatedPersonalEmail, sent]);

  const suggestedNewEmail = React.useMemo(() => {
    if (!lead) return null;
    const known = [relatedEmailAddress, relatedPersonalEmail].filter(Boolean);
    return findSuggestedNewEmailFromMessages(relatedEmails, known);
  }, [lead, relatedEmailAddress, relatedPersonalEmail, relatedEmails]);

  const relatedEmailThreads = React.useMemo(() => {
    const normalizeSubject = (subject: string) =>
      subject
        .replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, "")
        .replace(/\s+/g, " ")
        .trim();
    const threads = new Map<
      string,
      {
        subject: string;
        messages: { from: string; date: string; snippet: string }[];
        lastAt: string;
      }
    >();
    for (const e of relatedEmails) {
      const cleaned = normalizeSubject(e.subject) || "(no subject)";
      const key = cleaned.toLowerCase();
      const message = { from: e.from, date: e.at, snippet: e.body.slice(0, 2_000) };
      const existing = threads.get(key);
      if (existing) {
        existing.messages.push(message);
        if (e.at > existing.lastAt) existing.lastAt = e.at;
      } else {
        threads.set(key, { subject: cleaned, messages: [message], lastAt: e.at });
      }
    }
    return Array.from(threads.values())
      .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1))
      .slice(0, 20)
      .map((t) => ({
        subject: t.subject,
        // Oldest-first so the model reads each conversation in natural order.
        messages: t.messages.sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 20),
      }));
  }, [relatedEmails]);
  const attributedStrategy = lead?.strategyId
    ? prospecting.strategies.find((item) => item.id === lead.strategyId)
    : undefined;
  const attributedPersona = lead?.personaId
    ? prospecting.personas.find((item) => item.id === lead.personaId)
    : undefined;
  const attributedAssignment = lead?.strategyAssignmentId
    ? prospecting.assignments.find((item) => item.id === lead.strategyAssignmentId)
    : undefined;

  const followupAiContext = React.useMemo(() => {
    if (!lead) return undefined;
    return {
      lead,
      account: ws.getAccountById(lead.accountId),
      contact: ws.getContactById(lead.contactId),
      deal: ws.deals.find((d) => d.leadId === lead.id),
      notes: ws.notes.filter((n) => n.leadId === lead.id),
      timeline: ws.timelineByLead[lead.id] ?? [],
      touchpoints: ws.touchpoints.filter((t) => t.leadId === lead.id),
      followups: ws.followups.filter((f) => f.leadId === lead.id),
      tasks: filterLeadTasksForLeadDetail(ws.leadTasks, lead.id, viewerForTasks),
      campaign: ws.getCampaignById(lead.campaignId),
      profile: ws.getProfileById(lead.profileId),
      strategy: attributedStrategy,
      persona: attributedPersona,
      strategyAssignment: attributedAssignment,
      labels: ws.crmLabels.filter((label) => lead.labelIds?.includes(label.id)),
      emailThreads: relatedEmailThreads,
    };
  }, [
    attributedAssignment,
    attributedPersona,
    attributedStrategy,
    lead,
    relatedEmailThreads,
    viewerForTasks,
    ws,
  ]);

  const fallbackOwnerOptions = React.useMemo(
    () => buildWorkspaceOwnerPickerOptions(ws.users, ws.currentUserId, ws.getOwnerDisplayName),
    [ws.users, ws.currentUserId, ws.getOwnerDisplayName],
  );
  const [activeMemberOptions, setActiveMemberOptions] = React.useState<OwnerOption[] | null>(null);

  React.useEffect(() => {
    if (ws.isDemo) return;

    let cancelled = false;
    void fetch("/api/org/members", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { members?: OrganizationMember[] };
        if (cancelled) return;
        const fromMembers = activeOrgMemberOwnerOptions(data.members ?? [], ws.users);
        if (fromMembers.length > 0) setActiveMemberOptions(fromMembers);
      })
      .catch(() => {
        /* keep CRM fallback */
      });

    return () => {
      cancelled = true;
    };
  }, [ws.isDemo, ws.users]);

  const ownerOptions = ws.isDemo
    ? fallbackOwnerOptions
    : (activeMemberOptions ?? fallbackOwnerOptions);

  const openBounceTasks = React.useMemo(
    () => (lead ? openBounceReviewTasksForLead(leadTasksForTab, lead.id) : []),
    [leadTasksForTab, lead?.id],
  );

  const followupsForLead = React.useMemo(
    () => (lead ? followups.filter((f) => f.leadId === lead.id) : followups),
    [followups, lead?.id],
  );
  const followupPlansMerged = React.useMemo(
    () => mergeFollowupPlans(ws.followupPlans, followupsForLead),
    [ws.followupPlans, followupsForLead],
  );
  const pausedBouncePlan = React.useMemo(
    () => (lead ? getPausedFollowupPlanForLead(followupPlansMerged, lead.id) : undefined),
    [followupPlansMerged, lead?.id],
  );

  const addScheduled = useEmailAccountStore((s) => s.addScheduled);
  const cancelScheduled = useEmailAccountStore((s) => s.cancelScheduled);
  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const activeMailboxId = useEmailAccountStore((s) => s.activeMailboxId);
  const mailViewAsUid = useEmailAccountStore((s) => s.mailViewAsUid);
  const globalEmailFooter = useEmailAccountStore((s) => s.globalEmailFooter);

  const pinned = lead ? ws.isLeadPinned(lead.id) : false;

  if (!lead) {
    return (
      <PageBody className="flex flex-col items-center justify-center gap-4 py-16">
        <p className="text-sm text-muted-foreground">This lead was not found in your current workspace.</p>
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={
            <Link href={backHref}>{backLabel}</Link>
          }
        />
        {!ws.isDemo && <WorkspaceEmptyHint />}
      </PageBody>
    );
  }

  const resolvedLead = lead;
  const canEditLead = ws.canEditLead(lead);
  const prospectSourceId = lead.prospectSourceId?.trim();
  const linkedSourceProspect = ws.leads.find(
    (candidate) =>
      candidate.id !== lead.id &&
      (candidate.linkedSalesLeadId?.trim() === lead.id ||
        (candidate.intakeKind === "prospect" &&
          candidate.accountId === lead.accountId &&
          candidate.contactId === lead.contactId)),
  );
  const prospectForSidebar =
    lead.intakeKind === "prospect" ||
    Boolean(lead.linkedSalesLeadId?.trim()) ||
    Boolean(lead.prospectChannelAssignments?.length)
      ? lead
      : prospectSourceId
        ? ws.getLeadById(prospectSourceId)
        : linkedSourceProspect ?? (backFrom === "prospects" ? lead : undefined);
  const account = ws.getAccountById(lead.accountId);
  const contact = ws.getContactById(lead.contactId);
  const deal = ws.deals.find((d) => d.leadId === lead.id);
  const moveBackMode = moveBackModeFor(lead);
  const moveBackBlocked = moveBackMode
    ? moveBackBlockedReason(lead, { hasDeal: Boolean(deal) })
    : null;
  const viewerUser = ws.getUserById(ws.currentUserId);
  const canMoveBackPermission =
    roleAtLeast(ws.viewerOrgRole, "admin") ||
    canAction(viewerUser, "prospects.move_back_to_prospect") ||
    canAction(viewerUser, "prospects.push_to_lead");
  const moveBackAuthorityOwnerId = prospectSourceId
    ? prospectOwnerIdOf(ws.getLeadById(prospectSourceId) ?? lead)
    : prospectOwnerIdOf(lead) || lead.ownerId?.trim() || "";
  const canMoveBackAccess =
    Boolean(ws.currentUserId) &&
    (roleAtLeast(ws.viewerOrgRole, "admin") ||
      Boolean(lead.sharedOwnerIds?.includes(ws.currentUserId)) ||
      moveBackAuthorityOwnerId === ws.currentUserId ||
      lead.ownerId?.trim() === ws.currentUserId);
  const showMoveBack =
    Boolean(moveBackMode) && canMoveBackPermission && canMoveBackAccess;
  const moveBackActivity: MoveBackActivity = {
    touches: lead.touches ?? 0,
    openFollowups: followups.filter((f) => !f.completedAt).length,
    hasActiveSequence: followupPlansMerged.some(
      (p) =>
        p.leadId === lead.id &&
        (p.status === "active" || p.status === "paused") &&
        (p.kind === "sequence" || Boolean(p.planSummary)),
    ),
  };
  const moveBackCopy = moveBackMode
    ? moveBackConfirmCopy(moveBackMode, moveBackActivity)
    : null;
  const moveBackNeedsAck = Boolean(moveBackCopy?.requiresAck);
  const companyEmail = (contact?.email || lead.contactEmail || "").trim() || undefined;
  const personalEmail = contact?.personalEmail?.trim() || undefined;
  const primaryEmail = companyEmail || personalEmail;
  const primaryPhone = contact?.phone;
  const emailBounced = contactHasBouncedEmail(contact);
  /** Blocking fix needed: no personal fallback, or an open bounce review task. */
  const needsEmailFix =
    (emailBounced && !personalEmail) || openBounceTasks.length > 0;
  const hasLinkedIn = leadHasLinkedIn(lead, contact);
  const suggestLinkedIn = Boolean(lead.suggestLinkedInSequence) && hasLinkedIn;
  const canResumeSequence = Boolean(
    pausedBouncePlan &&
      (pausedBouncePlan.pausedReason?.includes("bounced") ||
        pausedBouncePlan.pausedReason?.includes("twice")),
  );
  const openFollowupCount = followups.filter((f) => !f.completedAt).length;
  const openTaskCount = leadTasksForTab.filter((t) => !t.completedAt).length;
  const emailStatus = resolveEmailVerificationStatus(contact, lead);
  const showVerifyEmail =
    canEditLead && Boolean(companyEmail) && !ws.isDemo && shouldOfferEmailVerify(emailStatus);

  async function handleVerifyCompanyEmail() {
    if (!companyEmail || verifyingEmail || ws.isDemo) return;
    setVerifyingEmail(true);
    try {
      const { results, summary } = await verifyLeadEmailsClient([resolvedLead.id]);
      const first = results[0];
      if (first?.error && !first.status) {
        toast.error(first.error);
        return;
      }
      toast.success(formatVerifySummary(summary), {
        description: first?.status
          ? `${companyEmail} → ${emailVerificationLabel(first.status)}`
          : undefined,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Email verification failed");
    } finally {
      setVerifyingEmail(false);
    }
  }

  async function handleResumeSequence(to: string) {
    if (!pausedBouncePlan || !lead) {
      throw new Error("No paused sequence to resume");
    }
    const mailbox = getActiveMailbox({ mailboxes, activeMailboxId });
    const result = await rerouteFollowupSequenceClient({
      leadId: lead.id,
      to,
      mailbox,
      plan: pausedBouncePlan,
      followups,
      isDemo: ws.isDemo,
      globalEmailFooter,
      addDemoScheduled: (row) => addScheduled(row),
      cancelSchedule: async (scheduledEmailId) => {
        const cancel = await cancelScheduledEmailClient({
          scheduledEmailId,
          isDemo: ws.isDemo,
          cancelDemo: cancelScheduled,
          followupId: followups.find((f) => f.scheduledEmailId === scheduledEmailId)?.id,
          selfUid: ws.currentUserId,
          mailViewAsUid,
          activeMailboxDataOwnerUid: mailbox.dataOwnerUid,
        });
        return !("error" in cancel);
      },
      updateFollowupDueAt: (followupId, dueAt) => {
        ws.updateFollowup(followupId, { dueAt });
      },
      setFollowupEmailSchedule: (followupId, schedule) => {
        ws.setFollowupEmailSchedule(followupId, schedule);
      },
      resumePlan: async (input) => {
        await ws.resumeFollowupPlan(input);
      },
    });
    if (!result.ok) throw new Error(result.error);
  }

  function openUpdateEmail(opts: {
    reason: "bounce" | "suggested" | "manual";
    suggestedEmail?: string;
  }) {
    setUpdateEmailReason(opts.reason);
    setUpdateEmailSuggested(opts.suggestedEmail);
    setUpdateEmailOpen(true);
  }
  const campaign = ws.getCampaignById(lead.campaignId);
  const profile = ws.getProfileById(lead.profileId);
  const needsOutreachProfile = CHANNELS_REQUIRING_OUTREACH_PROFILE.includes(lead.channel);
  const outreachProfileSummary = needsOutreachProfile
    ? profile?.name?.trim() ||
      (lead.profileId
        ? `Profile not found (id ${lead.profileId.length > 14 ? `${lead.profileId.slice(0, 12)}…` : lead.profileId})`
        : "Not set, open Edit and choose a profile")
    : undefined;
  const showAttributionCard = Boolean(
    campaign || profile || lead.profileId || needsOutreachProfile,
  );
  const ownerSelectValue = lead.ownerId?.trim() || OPEN_QUEUE_OWNER_VALUE;

  async function copyToClipboard(text: string, okMsg: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(okMsg);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  function handleSaveLead(patch: Partial<Lead>) {
    const latest = ws.getLeadById(leadId);
    if (!latest) return;
    const nextStage = patch.stage;
    if (nextStage != null && nextStage !== latest.stage) {
      ws.updateLeadStage(latest.id, nextStage, latest.stage, ws.currentUserId);
    }
    const rest: Partial<Lead> = { ...patch };
    delete rest.stage;
    if ("ownerId" in rest) {
      const nextOwnerId = rest.ownerId ?? "";
      if (nextOwnerId !== latest.ownerId) {
        assignLeadOwner(nextOwnerId);
      }
      delete rest.ownerId;
    }
    if (Object.keys(rest).length > 0) {
      ws.patchLead(latest.id, rest);
      ws.bumpLeadActivity(latest.id);
    }
  }

  function newTimelineId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return `te-${crypto.randomUUID()}`;
    }
    return `te-${Date.now()}`;
  }

  function ownerDisplayName(ownerId: string): string {
    if (!ownerId.trim()) return "Open queue";
    return (
      ownerOptions.find((o) => o.id === ownerId)?.label ||
      ws.getUserById(ownerId)?.displayName?.trim() ||
      ws.getOwnerDisplayName(ownerId)?.trim() ||
      "Unknown owner"
    );
  }

  function assignLeadOwner(nextOwnerId: string, options?: { claim?: boolean }) {
    const currentOwnerId = resolvedLead.ownerId?.trim() || "";
    const cleanNextOwnerId = nextOwnerId.trim();
    if (cleanNextOwnerId === currentOwnerId) return;

    const fromName = ownerDisplayName(currentOwnerId);
    const toName = ownerDisplayName(cleanNextOwnerId);
    const actorName =
      ws.getOwnerDisplayName(ws.currentUserId)?.trim() ||
      ws.users.find((u) => u.id === ws.currentUserId)?.displayName?.trim() ||
      "Teammate";

    ws.patchLead(resolvedLead.id, { ownerId: cleanNextOwnerId });
    ws.patchAccount(resolvedLead.accountId, { ownerId: cleanNextOwnerId });
    ws.patchContact(resolvedLead.contactId, { ownerId: cleanNextOwnerId });
    ws.addTimelineEvent({
      id: newTimelineId(),
      leadId: resolvedLead.id,
      type: "assignment_changed",
      actorId: ws.currentUserId,
      summary: options?.claim
        ? `${toName} claimed this prospect from the open queue`
        : `Reassigned from ${fromName} to ${toName}`,
      createdAt: new Date().toISOString(),
    });
    ws.bumpLeadActivity(resolvedLead.id);

    void createUserNotifications(
      { organizationId: ws.organizationId, isDemo: ws.isDemo },
      buildOwnershipHandoffNotifications({
        organizationId: ws.organizationId || "demo",
        actorId: ws.currentUserId,
        actorName,
        previousOwnerId: currentOwnerId,
        nextOwnerId: cleanNextOwnerId,
        leadId: resolvedLead.id,
        lead: resolvedLead,
        claim: options?.claim,
      }),
    );

    toast.success(cleanNextOwnerId ? "Owner updated" : "Moved to open queue");
  }

  return (
    <>
      <AlertDialog open={deleteOpen} onOpenChange={(o) => !deleteBusy && setDeleteOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {lead.contactName} at {lead.companyName} from your workspace. Notes and activity
              for this lead will no longer appear. Only organization owners and admins can do this.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteBusy}
              onClick={() => {
                void (async () => {
                  setDeleteBusy(true);
                  const ok = await ws.deleteLead(lead.id);
                  setDeleteBusy(false);
                  if (ok) {
                    setDeleteOpen(false);
                    router.push(backHref);
                  }
                })();
              }}
            >
              {deleteBusy ? "Deleting…" : "Delete lead"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={moveBackOpen}
        onOpenChange={(o) => {
          if (moveBackBusy) return;
          setMoveBackOpen(o);
          if (!o) setMoveBackAck(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{moveBackCopy?.title ?? "Move back to prospect?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {moveBackCopy?.description ??
                "This returns the record to Prospects and removes it from the sales pipeline."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {moveBackNeedsAck ? (
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border/80 bg-muted/30 px-3 py-2.5 text-sm">
              <Checkbox
                checked={moveBackAck}
                onCheckedChange={(v) => setMoveBackAck(v === true)}
                disabled={moveBackBusy}
                className="mt-0.5"
              />
              <span className="text-foreground">
                {moveBackCopy?.ackLabel ??
                  "I understand open follow-ups and scheduled emails will be cancelled."}
              </span>
            </label>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={moveBackBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={moveBackBusy || (moveBackNeedsAck && !moveBackAck)}
              onClick={() => {
                void (async () => {
                  if (moveBackNeedsAck && !moveBackAck) {
                    toast.error("Confirm that outreach will be cancelled first.");
                    return;
                  }
                  setMoveBackBusy(true);
                  try {
                    const res = await fetch(`/api/org/leads/${lead.id}/move-back-to-prospect`, {
                      method: "POST",
                    });
                    const data = (await res.json().catch(() => ({}))) as {
                      error?: string;
                      prospectId?: string;
                      closedFollowups?: number;
                      cancelledScheduled?: number;
                    };
                    if (!res.ok) {
                      toast.error(data.error ?? "Could not move back to prospect");
                      return;
                    }
                    const closed = data.closedFollowups ?? 0;
                    const cancelled = data.cancelledScheduled ?? 0;
                    toast.success(
                      closed > 0 || cancelled > 0
                        ? `Moved back to prospect · cancelled ${closed} follow-up${closed === 1 ? "" : "s"}`
                        : "Moved back to prospect",
                    );
                    setMoveBackOpen(false);
                    setMoveBackAck(false);
                    const prospectId = data.prospectId?.trim() || lead.id;
                    router.push(`/leads/${prospectId}?from=prospects`);
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    toast.error("Could not move back to prospect", { description: msg });
                  } finally {
                    setMoveBackBusy(false);
                  }
                })();
              }}
            >
              {moveBackBusy ? "Moving…" : moveBackCopy?.confirmLabel ?? "Move back to prospect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <PageHeader
        title={
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              nativeButton={false}
              render={
                <Link href={backHref} aria-label={backLabel}>
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              }
            />
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-primary/15 text-primary font-semibold text-sm">
                {initials(lead.contactName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate">{lead.contactName}</span>
                {canEditLead ? (
                  <Select
                    value={lead.stage}
                    onValueChange={(v) => {
                      if (!v || v === lead.stage) return;
                      const next = v as PipelineStage;
                      handleSaveLead({ stage: next });
                      toast.success(`Stage → ${STAGES_BY_KEY[next].label}`);
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className={cn(
                        "h-7 w-fit min-w-30 gap-1 rounded-md border font-medium capitalize shadow-none",
                        STAGE_TONE_CLASS[STAGES_BY_KEY[lead.stage].tone],
                      )}
                    >
                      <SelectValue>
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" />
                          {STAGES_BY_KEY[lead.stage].label}
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {PIPELINE_STAGES.map((s) => (
                        <SelectItem key={s.key} value={s.key}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <StageBadge stage={lead.stage} className="h-7" />
                )}
                <ChannelTagsRow
                  channelTags={lead.channelTags}
                  fallbackChannel={lead.channel}
                  tagTooltips={channelTagTooltips}
                />
                {lead.intakeKind === "prospect" && (
                  <Badge variant="outline" className={cn("h-7 font-normal", INTAKE_KIND_META.prospect.className)}>
                    {INTAKE_KIND_META.prospect.short}
                  </Badge>
                )}
                {lead.doNotContact ? (
                  <Badge
                    variant="outline"
                    className="h-7 gap-1 border-destructive/30 bg-destructive/10 text-destructive"
                  >
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Do not contact
                  </Badge>
                ) : null}
                <LeadQualityBadge
                  lead={lead}
                  playbook={ws.intentPlaybook}
                  crmLabels={ws.crmLabels}
                  className="h-7"
                />
                {needsOutreachProfile && (
                  <Badge
                    variant="outline"
                    className="h-7 max-w-[min(240px,46vw)] shrink truncate font-normal text-muted-foreground"
                    title={outreachProfileSummary}
                  >
                    {profile?.name?.trim() || (lead.profileId ? "Profile (unresolved)" : "No profile")}
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground font-normal mt-0.5">
                {lead.contactTitle} · {lead.companyName}
              </div>
            </div>
          </div>
        }
        actions={
          <>
            {!lead.ownerId?.trim() && ws.currentUserId ? (
              <Button
                variant="default"
                size="sm"
                type="button"
                onClick={() => {
                  const uid = ws.currentUserId;
                  if (!uid) return;
                  assignLeadOwner(uid, { claim: true });
                }}
              >
                <UserPlus className="h-3.5 w-3.5" /> Claim
              </Button>
            ) : null}
            <LeadSourceButton lead={lead} />
            <Button
              variant={pinned ? "default" : "outline"}
              size="sm"
              type="button"
              onClick={() => {
                ws.toggleLeadPin(lead.id);
                toast.success(pinned ? "Unpinned" : "Pinned for this session");
              }}
            >
              <Star className={cn("h-3.5 w-3.5", pinned && "fill-current")} /> Pin
            </Button>
            {ws.canEditLead(lead) ? (
              <Button variant="outline" size="sm" type="button" onClick={() => setEditingSection("all")}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            ) : prospectSourceId ? (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={
                  <Link href={`/leads/${prospectSourceId}?from=prospects`}>
                    <Pencil className="h-3.5 w-3.5" /> Edit in prospect
                  </Link>
                }
              />
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="icon-sm" aria-label="More actions">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setAnalyzeOpen(true)}>
                  <Sparkles className="h-3.5 w-3.5" />
                  Analyze
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    const url = typeof window !== "undefined" ? window.location.href : "";
                    void copyToClipboard(url, "Link copied");
                  }}
                >
                  <Share2 className="h-3.5 w-3.5" />
                  Copy link
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void copyToClipboard(lead.id, "Lead ID copied")}>
                  Copy lead ID
                </DropdownMenuItem>
                {showMoveBack ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={Boolean(moveBackBlocked)}
                      title={moveBackBlocked ?? undefined}
                      onSelect={(e) => {
                        e.preventDefault();
                        if (moveBackBlocked) {
                          toast.error(moveBackBlocked);
                          return;
                        }
                        setMoveBackAck(false);
                        setMoveBackOpen(true);
                      }}
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      Move back to prospect
                    </DropdownMenuItem>
                  </>
                ) : null}
                {ws.canDeleteLeads ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={(e) => {
                        e.preventDefault();
                        setDeleteOpen(true);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete lead
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      {lead.doNotContact ? (
        <div className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive sm:px-6">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          Outreach and scheduling actions are disabled for this record.
          {canEditLead ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="ml-auto h-auto p-0 text-destructive"
              onClick={() => setEditingSection("routing")}
            >
              Review setting
            </Button>
          ) : null}
        </div>
      ) : null}
      <PageBody className="p-0">
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] min-h-[calc(100vh-8rem)]">
          <div className="border-r p-4 sm:p-6">
            <Card className="mb-4">
              <CardContent className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Next best action
                  </p>
                  <p className="mt-1 truncate text-sm font-medium">
                    {lead.doNotContact
                      ? "Review do-not-contact status before outreach"
                      : needsEmailFix
                        ? "Update bounced email so outreach can continue"
                        : suggestedNewEmail
                          ? `Apply suggested email: ${suggestedNewEmail}`
                          : lead.nextAction || "Add a next action to keep this record moving"}
                  </p>
                  {!lead.doNotContact && (companyEmail || personalEmail || primaryPhone) ? (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {companyEmail ? (
                        <a href={`mailto:${companyEmail}`} className="inline-flex items-center gap-1 hover:text-primary">
                          <Mail className="h-3 w-3" />
                          <span className="text-muted-foreground/80">Company</span>
                          {companyEmail}
                          {emailBounced ? (
                            <span className="inline-flex items-center gap-0.5 text-destructive">
                              <MailWarning className="h-3 w-3" />
                              bounced
                            </span>
                          ) : null}
                        </a>
                      ) : null}
                      {personalEmail ? (
                        <a href={`mailto:${personalEmail}`} className="inline-flex items-center gap-1 hover:text-primary">
                          <Mail className="h-3 w-3" />
                          <span className="text-muted-foreground/80">Personal</span>
                          {personalEmail}
                        </a>
                      ) : null}
                      {primaryPhone ? (
                        <a href={`tel:${primaryPhone}`} className="inline-flex items-center gap-1 hover:text-primary">
                          <Phone className="h-3 w-3" />
                          {primaryPhone}
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                  {canEditLead && contact && (needsEmailFix || suggestedNewEmail) ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          openUpdateEmail({
                            reason: needsEmailFix ? "bounce" : "suggested",
                            suggestedEmail: suggestedNewEmail ?? undefined,
                          })
                        }
                      >
                        {needsEmailFix ? "Update bounced email" : "Use suggested email"}
                      </Button>
                    </div>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="justify-start"
                  onClick={() => onTabChange("followups")}
                >
                  <ListTodo className="h-3.5 w-3.5" />
                  {openFollowupCount} followup{openFollowupCount === 1 ? "" : "s"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="justify-start"
                  onClick={() => onTabChange("tasks")}
                >
                  <ListTodo className="h-3.5 w-3.5" />
                  {openTaskCount} task{openTaskCount === 1 ? "" : "s"}
                </Button>
              </CardContent>
            </Card>
            <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
              <div className="-mx-1 overflow-x-auto px-1 pb-1 scrollbar-thin">
                <TabsList className="min-w-max">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="timeline">
                  Timeline
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {timeline.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="touchpoints">
                  Touchpoints
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {touchpoints.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="notes">
                  Notes
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {notesTabCount}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="followups">
                  Followups
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {followups.filter((f) => !f.completedAt).length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="tasks">
                  Tasks
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {leadTasksForTab.filter((t) => !t.completedAt).length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="emails">
                  Emails
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {relatedEmails.length}
                  </Badge>
                </TabsTrigger>
                </TabsList>
              </div>

              <div className="mt-4">
                <div className="mb-4 space-y-3">
                  <LeadContactEmailActionBanner
                    contact={contact}
                    suggestedEmail={suggestedNewEmail}
                    canEdit={canEditLead && Boolean(contact)}
                    onUpdateEmail={openUpdateEmail}
                    suggestLinkedInSequence={suggestLinkedIn}
                    hasLinkedIn={hasLinkedIn}
                    onBuildLinkedInSequence={() => setLinkedinSuggestOpen(true)}
                  />
                  <LeadReplyReviewBanner lead={lead} />
                  {!canEditLead && prospectSourceId && lead.intakeKind !== "prospect" ? (
                    <p className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      This lead is synced from a prospect. Update channel, stage, and other fields on the{" "}
                      <Link href={`/leads/${prospectSourceId}?from=prospects`} className="text-primary hover:underline">
                        prospect record
                      </Link>
                      . Only workspace admins can edit the lead directly.
                    </p>
                  ) : null}
                </div>
                <TabsContent value="overview">
                  <LeadOverview
                    lead={lead}
                    account={account}
                    contact={contact}
                    deal={deal}
                    campaign={campaign}
                    profile={profile}
                    strategy={attributedStrategy}
                    persona={attributedPersona}
                    strategyAssignment={attributedAssignment}
                    outreachProfileSummary={outreachProfileSummary}
                    outreachProfileFieldLabel={needsOutreachProfile ? outreachProfileFieldLabel(lead.channel) : undefined}
                    onEditSection={setEditingSection}
                    onEditRecord={setProspectFieldsSection}
                    onUpdateEmail={
                      contact
                        ? () =>
                            openUpdateEmail({
                              reason: needsEmailFix ? "bounce" : suggestedNewEmail ? "suggested" : "manual",
                              suggestedEmail: suggestedNewEmail ?? undefined,
                            })
                        : undefined
                    }
                  />
                </TabsContent>
                <TabsContent value="timeline">
                  <LeadTimeline events={timeline} lead={lead} viewerForTasks={viewerForTasks} />
                </TabsContent>
                <TabsContent value="touchpoints">
                  <LeadTouchpoints touchpoints={touchpoints} lead={lead} />
                </TabsContent>
                <TabsContent value="notes">
                  <LeadNotes notes={notes} leadId={lead.id} leadProfileNotes={lead.notes} />
                </TabsContent>
                <TabsContent value="followups">
                  <LeadFollowups
                    followups={followups}
                    lead={lead}
                    aiContext={followupAiContext}
                    onFixEmailAndResume={
                      canEditLead && contact
                        ? () =>
                            openUpdateEmail({
                              reason: "bounce",
                              suggestedEmail: suggestedNewEmail ?? undefined,
                            })
                        : undefined
                    }
                  />
                </TabsContent>
                <TabsContent value="tasks">
                  <LeadTasksPanel tasks={leadTasksForTab} lead={lead} />
                </TabsContent>
                <TabsContent value="emails">
                  <LeadEmailsPanel lead={lead} contactEmail={primaryEmail} />
                </TabsContent>
              </div>
            </Tabs>
          </div>

          <aside className="p-6 bg-muted/20 space-y-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide">Owner</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                <UserChip userId={lead.ownerId} size="md" />
                {canEditLead ? (
                  <Select
                    value={ownerSelectValue}
                    onValueChange={(v) => {
                      if (!v) return;
                      assignLeadOwner(v === OPEN_QUEUE_OWNER_VALUE ? "" : v);
                    }}
                  >
                    <SelectTrigger size="sm" className="h-8 w-full justify-between">
                      <SelectValue placeholder="Add owner">
                        {lead.ownerId?.trim()
                          ? ownerPickerTriggerLabel(lead.ownerId, ownerOptions)
                          : "Add owner"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={OPEN_QUEUE_OWNER_VALUE}>Open queue (unassigned)</SelectItem>
                      {ownerOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                {lead.scraperId && (
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <span>Lead by</span>
                    <UserChip userId={lead.scraperId} size="xs" />
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">Added {fmtDate(lead.createdAt)}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide">Contact</CardTitle>
                {canEditLead && contact ? (
                  <CardAction className="flex items-center gap-1">
                    {showVerifyEmail ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 px-2 text-xs"
                        disabled={verifyingEmail}
                        onClick={() => void handleVerifyCompanyEmail()}
                      >
                        {verifyingEmail ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ShieldCheck className="h-3.5 w-3.5" />
                        )}
                        {emailBounced ? "Re-verify" : "Verify email"}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant={emailBounced ? "default" : "ghost"}
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() =>
                        openUpdateEmail({
                          reason: needsEmailFix ? "bounce" : suggestedNewEmail ? "suggested" : "manual",
                          suggestedEmail: suggestedNewEmail ?? undefined,
                        })
                      }
                    >
                      {emailBounced ? <MailWarning className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                      {emailBounced ? "Fix email" : "Change email"}
                    </Button>
                  </CardAction>
                ) : null}
              </CardHeader>
              <CardContent className="pt-0 space-y-2 text-sm">
                {companyEmail ? (
                  <div className="flex items-center gap-2">
                    <Mail className={cn("h-3.5 w-3.5 shrink-0", emailBounced ? "text-destructive" : "text-muted-foreground")} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Company</p>
                      <a href={`mailto:${companyEmail}`} className="block truncate hover:text-primary">
                        {companyEmail}
                      </a>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "shrink-0 text-[10px] font-medium",
                        emailVerificationBadgeClass(emailStatus),
                      )}
                      title={emailVerificationDescription(emailStatus)}
                    >
                      {emailVerificationLabel(emailStatus)}
                    </Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="h-6 w-6 shrink-0"
                      aria-label="Copy company email"
                      onClick={() => void copyToClipboard(companyEmail, "Company email copied")}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                ) : null}
                {personalEmail ? (
                  <div className="flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Personal</p>
                      <a href={`mailto:${personalEmail}`} className="block truncate hover:text-primary">
                        {personalEmail}
                      </a>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="h-6 w-6 shrink-0"
                      aria-label="Copy personal email"
                      onClick={() => void copyToClipboard(personalEmail, "Personal email copied")}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                ) : null}
                {primaryPhone && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <a href={`tel:${primaryPhone}`} className="min-w-0 flex-1 truncate tabular-nums hover:text-primary">
                      {primaryPhone}
                    </a>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="h-6 w-6 shrink-0"
                      aria-label="Copy phone number"
                      onClick={() => void copyToClipboard(primaryPhone, "Phone number copied")}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                )}
                {contact?.linkedin && (
                  <div className="flex items-center gap-2">
                    <LinkIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <a
                      href={contact.linkedin}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate hover:text-primary text-primary/80"
                    >
                      {contact.linkedin.replace("https://", "")}
                    </a>
                  </div>
                )}
                {contact?.location && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>{contact.location}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <LeadSchedulingPanel lead={lead} />

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide">
                  Intake & prospecting
                </CardTitle>
                {account && contact && canEditLead ? (
                  <CardAction>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setProspectFieldsSection("all")}
                    >
                      <Pencil className="h-3 w-3" /> Edit
                    </Button>
                  </CardAction>
                ) : null}
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <LeadScraperSourceSummary lead={prospectForSidebar ?? lead} />
                <ProspectChannelPanel prospect={prospectForSidebar ?? lead} />
                <div className="flex flex-wrap gap-2">
                  <LeadSourceButton lead={prospectForSidebar ?? lead} />
                </div>
                {lead.sharedOwnerIds?.length ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>Co-owners:</span>
                    {lead.sharedOwnerIds.map((uid) => (
                      <UserChip key={uid} userId={uid} size="xs" />
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {account && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide flex items-center justify-between">
                    Company
                    <Link
                      href={`/accounts/${account.id}`}
                      className="text-[10px] normal-case text-primary/90 hover:text-primary"
                    >
                      View account →
                    </Link>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    {account.name}
                  </div>
                  <Separator />
                  <dl className="grid grid-cols-[88px_1fr] gap-y-1.5 text-xs">
                    <dt className="text-muted-foreground">Industry</dt>
                    <dd>{account.industry}</dd>
                    <dt className="text-muted-foreground">Size</dt>
                    <dd>{account.size}</dd>
                    <dt className="text-muted-foreground">Revenue</dt>
                    <dd>{account.revenueRange ? REVENUE_RANGES[account.revenueRange] : "-"}</dd>
                    <dt className="text-muted-foreground">Founded</dt>
                    <dd>{account.yearFounded ?? "-"}</dd>
                    <dt className="text-muted-foreground">Location</dt>
                    <dd>
                      {[account.city, account.state, account.country].filter(Boolean).join(", ") ||
                        account.location ||
                        "-"}
                    </dd>
                    {account.businessDescription && (
                      <>
                        <dt className="text-muted-foreground">Summary</dt>
                        <dd className="line-clamp-3">{account.businessDescription}</dd>
                      </>
                    )}
                    <dt className="text-muted-foreground">Website</dt>
                    <dd>
                      {account.website ? (
                        <a
                          href={account.website}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-primary text-primary/80"
                        >
                          {account.domain}
                        </a>
                      ) : (
                        "-"
                      )}
                    </dd>
                  </dl>
                  {account.techStack && account.techStack.length > 0 && (
                    <>
                      <Separator />
                      <div className="flex flex-wrap gap-1">
                        {account.techStack.map((t) => (
                          <Badge key={t} variant="outline" className="text-[10px]">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {showAttributionCard && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide">
                    Attribution
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2 text-sm">
                  {campaign && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground text-xs">Campaign</span>
                      <span className="truncate">{campaign.name}</span>
                    </div>
                  )}
                  {(needsOutreachProfile || lead.profileId || profile) && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground text-xs">
                        {needsOutreachProfile ? outreachProfileFieldLabel(lead.channel) : "Profile"}
                      </span>
                      <span className="truncate text-right" title={outreachProfileSummary}>
                        {profile?.name?.trim() ||
                          (lead.profileId
                            ? `Not in workspace (${lead.profileId.length > 14 ? `${lead.profileId.slice(0, 12)}…` : lead.profileId})`
                            : needsOutreachProfile
                              ? (outreachProfileSummary ?? "-")
                              : "-")}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3" /> Insights
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2 text-xs text-muted-foreground">
                {aiInsights ? (
                  <>
                    <p className="text-sm text-foreground leading-relaxed">{aiInsights.summary}</p>
                    <p>
                      AI risk: <span className="font-semibold capitalize">{aiInsights.riskLevel}</span>
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      Response time was{" "}
                      <span className="font-semibold text-foreground tabular-nums">
                        {responseTimeMinutes != null ? `${responseTimeMinutes}m` : "n/a"}
                      </span>
                      {responseTimeMinutes != null && responseTimeMinutes < 60
                        ? ", in the top 10%."
                        : responseTimeMinutes != null
                          ? ", slower than team average."
                          : ""}
                    </p>
                    <p>
                      Last activity {fmtRelative(lead.lastActivityAt)} · {lead.touches} touches total.
                    </p>
                  </>
                )}
                {lead.estimatedValue && (
                  <p>
                    Estimated value{" "}
                    <span className="font-semibold text-foreground">{fmtCurrency(lead.estimatedValue)}</span>
                    {lead.expectedCloseDate && ` · close ${fmtDate(lead.expectedCloseDate, "MMM d")}`}
                  </p>
                )}
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-xs"
                  onClick={() => setAnalyzeOpen(true)}
                >
                  Run AI analysis
                </Button>
              </CardContent>
            </Card>
          </aside>
        </div>
      </PageBody>

      <LeadAnalyzeDialog
        open={analyzeOpen}
        onOpenChange={setAnalyzeOpen}
        lead={lead}
        emailThreads={relatedEmailThreads}
        demoContext={
          ws.isDemo
            ? {
                lead,
                account: account ?? undefined,
                contact: contact ?? undefined,
                deal: deal ?? undefined,
                notes,
                timeline,
                touchpoints,
                followups,
                tasks: leadTasksForTab,
                campaign: campaign ?? undefined,
                profile: profile ?? undefined,
                strategy: attributedStrategy,
                persona: attributedPersona,
                strategyAssignment: attributedAssignment,
                labels: ws.crmLabels.filter((label) => lead.labelIds?.includes(label.id)),
                emailThreads: relatedEmailThreads,
              }
            : undefined
        }
        onAnalysis={(a) => {
          setAiInsights({ summary: a.summary, riskLevel: a.riskLevel });
          if (ws.currentUserId) {
            ws.addTimelineEvent({
              id:
                typeof crypto !== "undefined" && "randomUUID" in crypto
                  ? `te-${crypto.randomUUID()}`
                  : `te-${Date.now()}`,
              leadId: lead.id,
              type: "ai_analysis",
              actorId: ws.currentUserId,
              summary: `AI analysis (${a.riskLevel} risk): ${a.summary.slice(0, 120)}${a.summary.length > 120 ? "…" : ""}`,
              createdAt: new Date().toISOString(),
            });
          }
        }}
      />
      <EditLeadDialog
        open={editingSection !== null}
        onOpenChange={(open) => {
          if (!open) setEditingSection(null);
        }}
        lead={lead}
        onSave={handleSaveLead}
        section={editingSection ?? "all"}
      />
      {account && contact && (
        <ProspectIntakeDialog
          open={prospectFieldsSection !== null}
          onOpenChange={(open) => {
            if (!open) setProspectFieldsSection(null);
          }}
          account={account}
          contact={contact}
          section={prospectFieldsSection ?? "all"}
          onSave={({ accountPatch, contactPatch, leadPatch }) => {
            const clearedContactPatch = contactPatchClearingBounce(contact, contactPatch);
            const emailChanges = diffContactEmailChanges(contact, clearedContactPatch);
            const nextLeadPatch = { ...leadPatch };
            // Manual form status is for qualify targets only — do not stamp provider
            // verification source/status onto the lead (badge trusts MV/bounce only).
            if (clearedContactPatch.emailVerificationStatus !== undefined) {
              clearedContactPatch.emailVerified =
                clearedContactPatch.emailVerificationStatus === "verified";
              clearedContactPatch.emailVerificationSource = "manual";
              nextLeadPatch.emailVerified =
                clearedContactPatch.emailVerificationStatus === "verified";
            } else if (clearedContactPatch.emailVerified !== undefined) {
              nextLeadPatch.emailVerified = clearedContactPatch.emailVerified;
            }

            if (Object.keys(accountPatch).length > 0) {
              ws.patchAccount(account.id, accountPatch);
            }
            if (Object.keys(clearedContactPatch).length > 0) {
              ws.patchContact(contact.id, clearedContactPatch);
            }
            if (Object.keys(nextLeadPatch).length > 0) {
              ws.patchLead(lead.id, nextLeadPatch);
            }
            ws.bumpLeadActivity(lead.id);

            for (const event of buildEmailChangeTimelineEvents({
              leadId: lead.id,
              actorId: ws.currentUserId,
              changes: emailChanges,
            })) {
              ws.addTimelineEvent(event);
            }

            if (emailChanges.length > 0) {
              for (const task of openBounceReviewTasksForLead(ws.leadTasks, lead.id)) {
                ws.setLeadTaskCompleted(task.id, true);
              }
            }
          }}
        />
      )}
      {contact ? (
        <UpdateContactEmailDialog
          open={updateEmailOpen}
          onOpenChange={setUpdateEmailOpen}
          lead={lead}
          contact={contact}
          suggestedEmail={updateEmailSuggested}
          reason={updateEmailReason}
          canResumeSequence={canResumeSequence}
          onResumeSequence={canResumeSequence ? handleResumeSequence : undefined}
        />
      ) : null}
      {followupAiContext ? (
        <SuggestFollowupsDialog
          open={linkedinSuggestOpen}
          onOpenChange={setLinkedinSuggestOpen}
          lead={lead}
          aiContext={followupAiContext}
          isDemo={ws.isDemo}
          currentUserId={ws.currentUserId}
          followupPlans={followupPlansMerged}
          regenerateFromPlan={pausedBouncePlan}
          initialChannel="linkedin_outbound"
          initialUserPrompt="Email outreach exhausted after hard bounces. Build a LinkedIn outbound sequence (connection request + follow-up messages) using the LinkedIn profile on this lead."
          onCreatePlanWithFollowups={(plan, batch) => {
            if (pausedBouncePlan) {
              ws.supersedeFollowupPlan(pausedBouncePlan.id, plan.id);
            }
            ws.createFollowupPlanWithFollowups(plan, batch);
            ws.patchLead(lead.id, { suggestLinkedInSequence: false });
            for (const task of openBounceReviewTasksForLead(ws.leadTasks, lead.id)) {
              ws.setLeadTaskCompleted(task.id, true);
            }
            setLinkedinSuggestOpen(false);
            toast.success("LinkedIn sequence created");
          }}
        />
      ) : null}
    </>
  );
}
