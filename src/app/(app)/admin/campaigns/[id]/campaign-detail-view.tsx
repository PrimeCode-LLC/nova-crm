"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChannelChip } from "@/components/common/channel-chip";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { fmtNumber, fmtPercent, fmtRelative } from "@/lib/format";
import { campaignReplyRate, instantlyCampaignHref } from "@/lib/campaign-utils";
const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-transparent",
  active: "bg-success/10 text-success border-success/20",
  paused: "bg-warning/10 text-warning border-warning/20",
  done: "bg-info/10 text-info border-info/20",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  done: "Done",
};

export function CampaignDetailView({ campaignId }: { campaignId: string }) {
  const { getCampaignById } = useWorkspace();
  const c = getCampaignById(campaignId);

  if (!c) {
    return (
      <>
        <PageHeader title="Campaign" description="This campaign was not found in the current workspace." />
        <PageBody>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <Link href="/admin/campaigns" className="inline-flex items-center gap-2">
                <ArrowLeft className="h-3.5 w-3.5" /> Back to campaigns
              </Link>
            }
          />
        </PageBody>
      </>
    );
  }

  const replyRate = campaignReplyRate(c);
  const instantlyHref = instantlyCampaignHref(c.externalRef);

  return (
    <>
      <PageHeader
        title={c.name}
        description="Campaign performance and sync details."
        actions={
          instantlyHref ? (
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
          ) : null
        }
      />
      <PageBody className="space-y-6">
        <Button
          variant="ghost"
          size="sm"
          className="-mt-2 w-fit px-0"
          nativeButton={false}
          render={
            <Link href="/admin/campaigns" className="inline-flex items-center gap-2">
              <ArrowLeft className="h-3.5 w-3.5" /> All campaigns
            </Link>
          }
        />

        <div className="flex flex-wrap items-center gap-3">
          <ChannelChip channel={c.channel} />
          <Badge variant="outline" className={`text-[10px] capitalize ${STATUS_TONE[c.status]}`}>
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current opacity-80" />
            {STATUS_LABEL[c.status]}
          </Badge>
          {c.externalRef ? (
            <span className="text-xs font-mono text-muted-foreground">{c.externalRef}</span>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label="Started" value={c.startedAt ? fmtRelative(c.startedAt) : "-"} />
          <StatCard label="Sent" value={fmtNumber(c.stats.sent)} />
          <StatCard label="Replied" value={fmtNumber(c.stats.replied)} />
          <StatCard label="Meetings" value={fmtNumber(c.stats.meetings)} />
          <StatCard label="Closed" value={fmtNumber(c.stats.closed)} />
          <StatCard label="Reply rate" value={fmtPercent(replyRate, 1)} highlight={replyRate >= 5} warn={replyRate >= 2 && replyRate < 5} />
        </div>
      </PageBody>
    </>
  );
}

function StatCard({
  label,
  value,
  highlight,
  warn,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          highlight ? "text-success" : warn ? "text-warning" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
