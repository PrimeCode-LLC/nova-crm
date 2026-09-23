"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  Clock,
  ExternalLink,
  Loader2,
  Mail,
  MailWarning,
  MousePointerClick,
  Pause,
  Play,
  RefreshCw,
  Send,
  Reply,
  Eye,
  UserX,
  Users,
  CheckCircle2,
  Handshake,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChannelChip } from "@/components/common/channel-chip";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useCrmEntityPages } from "@/hooks/use-crm-entity-pages";
import { isLiveCrmSnapshotDisabled } from "@/lib/dashboard-kpi-v2-flags";
import type { Lead } from "@/lib/types";
import { fmtNumber, fmtPercent, fmtRelative, fmtDate } from "@/lib/format";
import { campaignReplyRate, campaignOpenRate, campaignBounceRate, instantlyCampaignHref } from "@/lib/campaign-utils";
import type { Campaign } from "@/lib/types";
import type { InstantlyCampaign } from "@/lib/integrations/instantly/types";
import { cn } from "@/lib/utils";
import { CampaignSequencePanel } from "@/components/outreach/campaign-sequence-panel";
import { CampaignLeadsPanel } from "@/components/outreach/campaign-leads-panel";
import { CampaignAccountsPanel } from "@/components/outreach/campaign-accounts-panel";
import { CampaignOptionsPanel } from "@/components/outreach/campaign-options-panel";
import { roleAtLeast } from "@/lib/platform/org-role";

const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-transparent",
  active: "bg-success/10 text-success border-success/20",
  paused: "bg-warning/10 text-warning border-warning/20",
  done: "bg-info/10 text-info border-info/20",
};

const STATUS_LABEL: Record<Campaign["status"], string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  done: "Done",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatScheduleDays(days: number[] | Record<string, boolean> | undefined): string | null {
  if (!days) return null;
  if (Array.isArray(days)) {
    return days.length > 0 ? days.map((d) => DAY_NAMES[d] ?? String(d)).join(", ") : null;
  }
  const labels = Object.entries(days)
    .filter(([, on]) => on)
    .map(([d]) => DAY_NAMES[Number(d)] ?? d);
  return labels.length > 0 ? labels.join(", ") : null;
}

type RemoteData = InstantlyCampaign & { email_list?: string[] };

const CAMPAIGN_TABS = ["overview", "sequence", "leads", "accounts", "options"] as const;

export function OutreachCampaignDetail({ campaignId }: { campaignId: string }) {
  const searchParams = useSearchParams();
  const { getCampaignById, leads, isDemo, viewerOrgRole } = useWorkspace();
  const snapshotOff = isLiveCrmSnapshotDisabled(isDemo);
  const campaignLeadPages = useCrmEntityPages({
    entity: "leads",
    enabled: snapshotOff && !isDemo,
    limit: 50,
    filters: { campaignId },
  });
  const c = getCampaignById(campaignId);
  const [syncing, setSyncing] = React.useState(false);
  const [acting, setActing] = React.useState(false);
  const [remote, setRemote] = React.useState<RemoteData | null>(null);
  const [connected, setConnected] = React.useState(false);
  const [accountEmails, setAccountEmails] = React.useState<string[]>([]);

  React.useEffect(() => {
    void (async () => {
      const res = await fetch("/api/integrations/instantly/connection");
      if (res.ok) {
        const d = (await res.json()) as { connected?: boolean };
        setConnected(Boolean(d.connected));
      }
    })();
  }, []);

  React.useEffect(() => {
    if (!c || isDemo || !connected) return;
    void (async () => {
      const res = await fetch(`/api/integrations/instantly/campaigns/${campaignId}`);
      if (!res.ok) return;
      const data = (await res.json()) as { remote?: RemoteData };
      if (data.remote) {
        setRemote(data.remote);
        if (data.remote.email_list?.length) setAccountEmails(data.remote.email_list);
      }
    })();
  }, [campaignId, c, isDemo, connected]);

  React.useEffect(() => {
    if (remote?.email_list) setAccountEmails(remote.email_list);
  }, [remote?.email_list]);

  if (!c) {
    return (
      <>
        <PageHeader title="Campaign" description="This campaign was not found." />
        <PageBody>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/outreach">Back</Link>} />
        </PageBody>
      </>
    );
  }

  const replyRate = campaignReplyRate(c);
  const openRate = campaignOpenRate(c);
  const bounceRate = campaignBounceRate(c);
  const instantlyHref = instantlyCampaignHref(c.externalRef);
  const campaignLeads = snapshotOff
    ? (campaignLeadPages.items as Lead[])
    : leads.filter((l) => l.campaignId === campaignId);
  const remoteAccounts = accountEmails;
  const canEditAccounts = roleAtLeast(viewerOrgRole, "manager") && (connected || isDemo);
  const schedule = remote?.campaign_schedule?.schedules?.[0];
  const scheduleDayLabels = schedule ? formatScheduleDays(schedule.days) : null;
  const tabParam = searchParams.get("tab");
  const initialTab = CAMPAIGN_TABS.includes(tabParam as (typeof CAMPAIGN_TABS)[number])
    ? (tabParam as (typeof CAMPAIGN_TABS)[number])
    : "overview";

  async function syncStats() {
    setSyncing(true);
    try {
      const res = await fetch(`/api/integrations/instantly/campaigns/${campaignId}/sync-stats`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(typeof d.error === "string" ? d.error : "Sync failed");
        return;
      }
      toast.success("Stats synced from Instantly");
      window.location.reload();
    } finally {
      setSyncing(false);
    }
  }

  async function setStatus(action: "activate" | "pause") {
    setActing(true);
    try {
      const res = await fetch(`/api/integrations/instantly/campaigns/${campaignId}/${action}`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(typeof d.error === "string" ? d.error : "Action failed");
        return;
      }
      toast.success(action === "activate" ? "Campaign activated" : "Campaign paused");
      window.location.reload();
    } finally {
      setActing(false);
    }
  }

  return (
    <>
      <PageHeader
        title={c.name}
        description="Cold email campaign, synced with Instantly."
        actions={
          <div className="flex flex-wrap gap-2">
            {connected && !isDemo && (
              <>
                <Button size="sm" variant="outline" disabled={syncing} onClick={() => void syncStats()}>
                  {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Sync stats
                </Button>
                {c.status !== "active" && (
                  <Button size="sm" disabled={acting} onClick={() => void setStatus("activate")}>
                    {acting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                    Activate
                  </Button>
                )}
                {c.status === "active" && (
                  <Button size="sm" variant="outline" disabled={acting} onClick={() => void setStatus("pause")}>
                    {acting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
                    Pause
                  </Button>
                )}
              </>
            )}
            {instantlyHref && (
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={
                  <a href={instantlyHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2">
                    <ExternalLink className="h-3.5 w-3.5" /> Open in Instantly
                  </a>
                }
              />
            )}
          </div>
        }
      />
      <PageBody className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          className="-mt-2 w-fit px-0"
          nativeButton={false}
          render={
            <Link href="/outreach" className="inline-flex items-center gap-2">
              <ArrowLeft className="h-3.5 w-3.5" /> All campaigns
            </Link>
          }
        />

        <div className="flex flex-wrap items-center gap-3">
          <ChannelChip channel={c.channel} />
          <Badge variant="outline" className={cn("text-[10px] capitalize", STATUS_TONE[c.status])}>
            {STATUS_LABEL[c.status]}
          </Badge>
          {c.sequenceSummary?.steps ? (
            <span className="text-xs text-muted-foreground">{c.sequenceSummary.steps} email steps</span>
          ) : null}
          {c.lastSyncedAt && (
            <span className="text-xs text-muted-foreground">
              Last synced {fmtRelative(c.lastSyncedAt)}
            </span>
          )}
        </div>

        <Tabs defaultValue={initialTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="sequence">
              Sequence{c.sequenceSummary?.steps ? ` (${c.sequenceSummary.steps})` : ""}
            </TabsTrigger>
            <TabsTrigger value="leads">
              Leads ({campaignLeads.length}
              {(c.stats.leadsCount ?? c.stats.contacted)
                ? ` / ${c.stats.leadsCount ?? c.stats.contacted}`
                : ""}
              )
            </TabsTrigger>
            <TabsTrigger value="accounts">Accounts{remoteAccounts.length > 0 ? ` (${remoteAccounts.length})` : ""}</TabsTrigger>
            <TabsTrigger value="options">Options</TabsTrigger>
          </TabsList>

          {/* ── Overview ── */}
          <TabsContent value="overview" className="mt-4 space-y-6">
            {/* Delivery */}
            <div>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Delivery</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard icon={<Users className="h-4 w-4" />} label="Total leads" value={fmtNumber(c.stats.leadsCount ?? 0)} />
                <StatCard icon={<Send className="h-4 w-4" />} label="Contacted" value={fmtNumber(c.stats.contacted ?? 0)} />
                <StatCard icon={<Mail className="h-4 w-4" />} label="Emails sent" value={fmtNumber(c.stats.sent)} />
                <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="Completed" value={fmtNumber(c.stats.completed ?? 0)} />
              </div>
            </div>

            {/* Engagement */}
            <div>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Engagement</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  icon={<Eye className="h-4 w-4" />}
                  label="Opened"
                  value={fmtNumber(c.stats.opened ?? 0)}
                  sub={openRate > 0 ? `${fmtPercent(openRate, 1)} open rate` : undefined}
                />
                <StatCard
                  icon={<Reply className="h-4 w-4" />}
                  label="Replied"
                  value={fmtNumber(c.stats.replied)}
                  sub={replyRate > 0 ? `${fmtPercent(replyRate, 2)} reply rate` : undefined}
                  highlight={replyRate >= 5}
                />
                <StatCard
                  icon={<MousePointerClick className="h-4 w-4" />}
                  label="Link clicks"
                  value={fmtNumber(c.stats.linkClicks ?? 0)}
                />
                <StatCard icon={<Handshake className="h-4 w-4" />} label="Meetings" value={fmtNumber(c.stats.meetings)} />
              </div>
            </div>

            {/* Health */}
            <div>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Health</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  icon={<MailWarning className="h-4 w-4" />}
                  label="Bounced"
                  value={fmtNumber(c.stats.bounced ?? 0)}
                  sub={bounceRate > 0 ? `${fmtPercent(bounceRate, 1)} bounce rate` : undefined}
                  warn={bounceRate > 5}
                />
                <StatCard icon={<UserX className="h-4 w-4" />} label="Unsubscribed" value={fmtNumber(c.stats.unsubscribed ?? 0)} />
                <StatCard icon={<Trophy className="h-4 w-4" />} label="Closed" value={fmtNumber(c.stats.closed)} />
                <StatCard
                  icon={<Calendar className="h-4 w-4" />}
                  label="Started"
                  value={c.startedAt ? fmtDate(c.startedAt, "MMM d, yyyy") : "-"}
                  sub={c.startedAt ? fmtRelative(c.startedAt) : undefined}
                />
              </div>
            </div>

            {/* Schedule */}
            {schedule && (
              <div>
                <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Schedule</h3>
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    {scheduleDayLabels && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="h-4 w-4 shrink-0" />
                        <span>{scheduleDayLabels}</span>
                      </div>
                    )}
                    {schedule.timing && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Clock className="h-4 w-4 shrink-0" />
                        <span>{schedule.timing.from} – {schedule.timing.to}</span>
                      </div>
                    )}
                    {schedule.timezone && (
                      <span className="text-xs text-muted-foreground/60">{schedule.timezone}</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── Sequence ── */}
          <TabsContent value="sequence" className="mt-4">
            <CampaignSequencePanel
              campaignId={campaignId}
              externalRef={c.externalRef}
              instantlyId={c.instantlyId}
              connected={connected}
              isDemo={isDemo}
            />
          </TabsContent>

          {/* ── Leads ── */}
          <TabsContent value="leads" className="mt-4">
            <CampaignLeadsPanel
              campaignId={campaignId}
              campaignLeads={campaignLeads}
              externalRef={c.externalRef}
              instantlyId={c.instantlyId}
              connected={connected}
              isDemo={isDemo}
              instantlyLeadCount={c.stats.leadsCount ?? c.stats.contacted}
            />
          </TabsContent>

          {/* ── Accounts ── */}
          <TabsContent value="accounts" className="mt-4">
            <CampaignAccountsPanel
              campaignId={campaignId}
              accounts={remoteAccounts}
              connected={connected}
              isDemo={isDemo}
              canEdit={canEditAccounts}
              onAccountsChange={(emails) => {
                setAccountEmails(emails);
                setRemote((prev) => (prev ? { ...prev, email_list: emails } : prev));
              }}
            />
          </TabsContent>

          {/* ── Options ── */}
          <TabsContent value="options" className="mt-4">
            <CampaignOptionsPanel
              campaignId={campaignId}
              remote={remote}
              accounts={remoteAccounts}
              connected={connected}
              isDemo={isDemo}
              canEdit={canEditAccounts}
              onOptionsChange={(patch) => {
                setRemote((prev) => (prev ? { ...prev, ...patch } : prev));
                if (patch.email_list) setAccountEmails(patch.email_list);
              }}
            />
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}

/* ── Stat Card ── */

function StatCard({
  icon,
  label,
  value,
  sub,
  highlight,
  warn,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p
        className={cn(
          "mt-1 text-lg font-semibold tabular-nums",
          highlight && "text-success",
          warn && "text-destructive",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
