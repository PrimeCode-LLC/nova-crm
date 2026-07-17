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
  ListTodo,
} from "lucide-react";

import { useWorkspace } from "@/components/providers/workspace-mode-provider";
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
import { channelLabelFromValue, buildChannelOptions } from "@/lib/channel-options";
import { buildChannelTagTooltipMap } from "@/lib/prospects/channel-tag-display";
import { useChannelAdminStore } from "@/stores/channel-admin-store";
import { UserChip } from "@/components/common/user-chip";
import { LeadTimeline } from "@/components/leads/lead-timeline";
import { LeadOverview } from "@/components/leads/lead-overview";
import { LeadTouchpoints } from "@/components/leads/lead-touchpoints";
import { LeadNotes } from "@/components/leads/lead-notes";
import { LeadFollowups } from "@/components/leads/lead-followups";
import { LeadSchedulingPanel } from "@/components/scheduling/lead-scheduling-panel";
import { LeadTasksPanel } from "@/components/leads/lead-tasks";
import { LeadEmailsPanel } from "@/components/leads/lead-emails-panel";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { fmtCurrency, fmtDate, fmtRelative, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
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
import { resolveLeadResponseTimeMinutes } from "@/lib/email/lead-response-time";
import { extractEmailAddresses } from "@/lib/email/reply-compose";
import {
  buildWorkspaceOwnerPickerOptions,
  ownerPickerTriggerLabel,
} from "@/lib/owner-scope";

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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabFromUrl = React.useMemo(() => tabFromSearchParams(searchParams), [searchParams]);
  const activeTab = tabFromUrl;
  const [editingSection, setEditingSection] = React.useState<LeadEditSection | null>(null);
  const [prospectFieldsOpen, setProspectFieldsOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteBusy, setDeleteBusy] = React.useState(false);
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
  const backHref =
    backFrom === "pipeline" ? "/pipeline" : backFrom === "prospects" ? "/prospects" : "/leads";
  const backLabel =
    backHref === "/pipeline"
      ? "Back to pipeline"
      : backHref === "/prospects"
        ? "Back to prospects"
        : "Back to leads";
  const lead = ws.getLeadById(leadId);
  const customChannels = useChannelAdminStore((s) => s.customChannels);
  const channelOptions = React.useMemo(() => buildChannelOptions(customChannels), [customChannels]);
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
  const relatedEmails = React.useMemo(() => {
    if (!lead) return [];
    const own = relatedEmailAddress.toLowerCase();
    const rows: { id: string; subject: string; at: string; from: string; to: string; body: string }[] = [];
    for (const [mailboxId, messages] of Object.entries(inboundByMailbox)) {
      for (const m of messages) {
        const mid = `${mailboxId}:in:${m.id}`;
        const manual = linkedLeadByMessageId[mid] === lead.id;
        const auto = Boolean(own) && extractEmailAddresses(m.from, m.to, m.cc).has(own);
        if (!manual && !auto) continue;
        rows.push({ id: mid, subject: m.subject, at: m.date, from: m.from, to: m.to, body: m.bodyText });
      }
    }
    for (const m of sent) {
      const manual = linkedLeadByMessageId[m.id] === lead.id;
      const auto = Boolean(own) && extractEmailAddresses(m.from, m.to, m.cc).has(own);
      if (!manual && !auto) continue;
      rows.push({ id: m.id, subject: m.subject, at: m.sentAt, from: m.from, to: m.to, body: m.body });
    }
    return rows.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [inboundByMailbox, linkedLeadByMessageId, lead, relatedEmailAddress, sent]);

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
      emailThreads: relatedEmails.map((e) => ({
        subject: e.subject,
        messages: [{ from: e.from, date: e.at, snippet: e.body.slice(0, 500) }],
      })),
    };
  }, [lead, relatedEmails, viewerForTasks, ws]);

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
  const primaryEmail = contact?.email || lead.contactEmail;
  const primaryPhone = contact?.phone;
  const openFollowupCount = followups.filter((f) => !f.completedAt).length;
  const openTaskCount = leadTasksForTab.filter((t) => !t.completedAt).length;
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
    const currentOwnerId = lead.ownerId?.trim() || "";
    const cleanNextOwnerId = nextOwnerId.trim();
    if (cleanNextOwnerId === currentOwnerId) return;

    const fromName = ownerDisplayName(currentOwnerId);
    const toName = ownerDisplayName(cleanNextOwnerId);

    ws.patchLead(lead.id, { ownerId: cleanNextOwnerId });
    ws.patchAccount(lead.accountId, { ownerId: cleanNextOwnerId });
    ws.patchContact(lead.contactId, { ownerId: cleanNextOwnerId });
    ws.addTimelineEvent({
      id: newTimelineId(),
      leadId: lead.id,
      type: "assignment_changed",
      actorId: ws.currentUserId,
      summary: options?.claim
        ? `${toName} claimed this prospect from the open queue`
        : `Reassigned from ${fromName} to ${toName}`,
      createdAt: new Date().toISOString(),
    });
    ws.bumpLeadActivity(lead.id);
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
                      : lead.nextAction || "Add a next action to keep this record moving"}
                  </p>
                  {!lead.doNotContact && (primaryEmail || primaryPhone) ? (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {primaryEmail ? (
                        <a href={`mailto:${primaryEmail}`} className="inline-flex items-center gap-1 hover:text-primary">
                          <Mail className="h-3 w-3" />
                          {primaryEmail}
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
                {!canEditLead && prospectSourceId && lead.intakeKind !== "prospect" ? (
                  <p className="mb-4 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    This lead is synced from a prospect. Update channel, stage, and other fields on the{" "}
                    <Link href={`/leads/${prospectSourceId}?from=prospects`} className="text-primary hover:underline">
                      prospect record
                    </Link>
                    . Only workspace admins can edit the lead directly.
                  </p>
                ) : null}
                <TabsContent value="overview">
                  <LeadOverview
                    lead={lead}
                    outreachProfileSummary={outreachProfileSummary}
                    outreachProfileFieldLabel={needsOutreachProfile ? outreachProfileFieldLabel(lead.channel) : undefined}
                    onEditSection={setEditingSection}
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
              </CardHeader>
              <CardContent className="pt-0 space-y-2 text-sm">
                {primaryEmail && (
                  <div className="flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <a href={`mailto:${primaryEmail}`} className="min-w-0 flex-1 truncate hover:text-primary">
                      {primaryEmail}
                    </a>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="h-6 w-6 shrink-0"
                      aria-label="Copy email address"
                      onClick={() => void copyToClipboard(primaryEmail, "Email copied")}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                )}
                {contact?.personalEmail && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="shrink-0">Personal</span>
                    <a href={`mailto:${contact.personalEmail}`} className="truncate hover:text-primary">
                      {contact.personalEmail}
                    </a>
                  </div>
                )}
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
                      onClick={() => setProspectFieldsOpen(true)}
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
                emailThreads: relatedEmails.map((e) => ({
                  subject: e.subject,
                  messages: [{ from: e.from, date: e.at, snippet: e.body.slice(0, 500) }],
                })),
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
          open={prospectFieldsOpen}
          onOpenChange={setProspectFieldsOpen}
          account={account}
          contact={contact}
          onSave={({ accountPatch, contactPatch, leadPatch }) => {
            ws.patchAccount(account.id, accountPatch);
            ws.patchContact(contact.id, contactPatch);
            if (Object.keys(leadPatch).length > 0) {
              ws.patchLead(lead.id, leadPatch);
            }
            ws.bumpLeadActivity(lead.id);
          }}
        />
      )}
    </>
  );
}
