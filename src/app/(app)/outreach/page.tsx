"use client";

import * as React from "react";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { fmtNumber, fmtPercent, fmtRelative } from "@/lib/format";
import { campaignReplyRate, campaignOpenRate, instantlyCampaignHref } from "@/lib/campaign-utils";
import type { Campaign } from "@/lib/types";
import { ExternalLink, Loader2, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { OutreachConnectionBanner } from "@/components/outreach/connection-banner";
import { CampaignWizard } from "@/components/outreach/campaign-wizard";

const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "text-success",
  paused: "text-warning",
  done: "text-info",
};

const STATUS_LABEL: Record<Campaign["status"], string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  done: "Done",
};

export default function OutreachPage() {
  const { campaigns } = useWorkspace();
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [connected, setConnected] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      const res = await fetch("/api/integrations/instantly/connection");
      if (res.ok) {
        const d = (await res.json()) as { connected?: boolean };
        setConnected(Boolean(d.connected));
      }
    })();
  }, []);

  const coldCampaigns = React.useMemo(
    () => campaigns.filter((c) => c.channel === "cold_email"),
    [campaigns],
  );

  async function syncFromInstantly() {
    setSyncing(true);
    try {
      const res = await fetch("/api/integrations/instantly/campaigns/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Sync failed");
        return;
      }
      const imported = Number(data.imported ?? 0);
      const updated = Number(data.updated ?? 0);
      toast.success("Campaigns synced from Instantly", {
        description: `${imported} imported, ${updated} updated (${data.total ?? 0} in Instantly).`,
      });
      window.location.reload();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Email outreach"
        description="Create and manage Instantly cold email campaigns from your CRM."
        actions={
          <div className="flex flex-wrap gap-2">
            {connected && (
              <Button
                size="sm"
                variant="outline"
                disabled={syncing}
                onClick={() => void syncFromInstantly()}
              >
                {syncing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Sync from Instantly
              </Button>
            )}
            <Button size="sm" onClick={() => setWizardOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> New campaign
            </Button>
          </div>
        }
      />
      <PageBody className="space-y-4">
        <OutreachConnectionBanner />
        <div className="rounded-md border overflow-y-auto">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Opened</TableHead>
                <TableHead className="text-right">Replied</TableHead>
                <TableHead className="text-right">Reply rate</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {coldCampaigns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    No outreach campaigns yet.
                    {connected
                      ? " Click Sync from Instantly or create a new campaign."
                      : " Connect Instantly in Settings, then sync or create a campaign."}
                  </TableCell>
                </TableRow>
              ) : (
                coldCampaigns.map((c) => {
                  const rr = campaignReplyRate(c);
                  const or = campaignOpenRate(c);
                  const href = instantlyCampaignHref(c.externalRef);
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="py-2">
                        <Link
                          href={`/outreach/${c.id}`}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          {c.name}
                        </Link>
                      </TableCell>
                      <TableCell className={cn("py-2 text-xs capitalize", STATUS_TONE[c.status])}>
                        {STATUS_LABEL[c.status]}
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground">
                        {c.startedAt ? fmtRelative(c.startedAt) : "—"}
                      </TableCell>
                      <TableCell className="py-2 text-right tabular-nums text-sm">
                        {fmtNumber(c.stats.leadsCount ?? 0)}
                      </TableCell>
                      <TableCell className="py-2 text-right tabular-nums text-sm">
                        {fmtNumber(c.stats.sent)}
                      </TableCell>
                      <TableCell className="py-2 text-right tabular-nums text-sm text-muted-foreground">
                        {fmtNumber(c.stats.opened ?? 0)}
                        {or > 0 && <span className="ml-1 text-[10px]">{fmtPercent(or, 0)}</span>}
                      </TableCell>
                      <TableCell className="py-2 text-right tabular-nums text-sm">
                        {fmtNumber(c.stats.replied)}
                      </TableCell>
                      <TableCell className="py-2 text-right tabular-nums text-sm">
                        <span className={cn(rr >= 5 && "text-success")}>{fmtPercent(rr, 2)}</span>
                      </TableCell>
                      <TableCell className="py-2">
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                            aria-label="Open in Instantly"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          {coldCampaigns.length} campaign{coldCampaigns.length === 1 ? "" : "s"}
          {connected ? " · synced with Instantly" : ""}
        </p>
      </PageBody>
      <CampaignWizard open={wizardOpen} onOpenChange={setWizardOpen} connected={connected} />
    </>
  );
}
