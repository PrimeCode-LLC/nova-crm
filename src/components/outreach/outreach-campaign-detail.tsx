"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Loader2, Pause, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChannelChip } from "@/components/common/channel-chip";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { fmtNumber, fmtPercent, fmtRelative } from "@/lib/format";
import { campaignReplyRate, instantlyCampaignHref } from "@/lib/campaign-utils";
import type { Campaign } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CampaignSequencePanel } from "@/components/outreach/campaign-sequence-panel";
import { CampaignLeadsPanel } from "@/components/outreach/campaign-leads-panel";

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

export function OutreachCampaignDetail({ campaignId }: { campaignId: string }) {
  const { getCampaignById, leads, isDemo } = useWorkspace();
  const c = getCampaignById(campaignId);
  const [syncing, setSyncing] = React.useState(false);
  const [acting, setActing] = React.useState(false);
  const [remoteAccounts, setRemoteAccounts] = React.useState<string[]>([]);
  const [connected, setConnected] = React.useState(false);

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
      const data = (await res.json()) as { remote?: { email_list?: string[] } };
      setRemoteAccounts(data.remote?.email_list ?? []);
    })();
  }, [campaignId, c, isDemo, connected]);

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
  const instantlyHref = instantlyCampaignHref(c.externalRef);
  const campaignLeads = leads.filter((l) => l.campaignId === campaignId);

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
        description="Cold email campaign — synced with Instantly."
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
        </div>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="sequence">
              Sequence{c.sequenceSummary?.steps ? ` (${c.sequenceSummary.steps})` : ""}
            </TabsTrigger>
            <TabsTrigger value="leads">Leads ({campaignLeads.length})</TabsTrigger>
            <TabsTrigger value="accounts">Accounts</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard label="Started" value={c.startedAt ? fmtRelative(c.startedAt) : "—"} />
              <StatCard label="Sent" value={fmtNumber(c.stats.sent)} />
              <StatCard label="Opened" value={fmtNumber(c.stats.opened ?? 0)} />
              <StatCard label="Replied" value={fmtNumber(c.stats.replied)} />
              <StatCard label="Meetings" value={fmtNumber(c.stats.meetings)} />
              <StatCard
                label="Reply rate"
                value={fmtPercent(replyRate, 1)}
                highlight={replyRate >= 5}
              />
            </div>
          </TabsContent>
          <TabsContent value="sequence" className="mt-4">
            <CampaignSequencePanel
              campaignId={campaignId}
              externalRef={c.externalRef}
              instantlyId={c.instantlyId}
              connected={connected}
              isDemo={isDemo}
            />
          </TabsContent>
          <TabsContent value="leads" className="mt-4">
            <CampaignLeadsPanel
              campaignId={campaignId}
              campaignLeads={campaignLeads}
              externalRef={c.externalRef}
              instantlyId={c.instantlyId}
              connected={connected}
              isDemo={isDemo}
            />
          </TabsContent>
          <TabsContent value="accounts" className="mt-4">
            {remoteAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No sending accounts on this campaign. Assign accounts in the wizard or Instantly dashboard.
              </p>
            ) : (
              <ul className="space-y-1">
                {remoteAccounts.map((email) => (
                  <li key={email} className="font-mono text-xs text-muted-foreground">
                    {email}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-lg font-semibold tabular-nums", highlight && "text-success")}>{value}</p>
    </div>
  );
}
