"use client";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/common/kpi-card";
import { FunnelChart } from "@/components/dashboard/funnel-chart";
import { PipelineDistribution } from "@/components/dashboard/pipeline-distribution";
import { PersonScorecard } from "@/components/dashboard/person-scorecard";
import { IdleLeads } from "@/components/dashboard/idle-leads";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { ChannelMix } from "@/components/dashboard/channel-mix";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { Target, Clock, DollarSign, TrendingUp, Inbox, Calendar, Download, Filter } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function DashboardPage() {
  const { leads, deals, isDemo } = useWorkspace();

  const totalOpen = leads.filter((l) => !["won", "lost"].includes(l.stage)).length;
  const idleCount = leads.filter((l) => l.isIdle).length;
  const avgResponseMin =
    leads.filter((l) => l.responseTimeMinutes != null).reduce((s, l) => s + (l.responseTimeMinutes ?? 0), 0) /
    Math.max(1, leads.filter((l) => l.responseTimeMinutes != null).length);
  const pipelineValue = deals
    .filter((d) => !["won", "lost"].includes(d.stage))
    .reduce((s, d) => s + d.value, 0);
  const closedValue = deals.filter((d) => d.stage === "won").reduce((s, d) => s + d.value, 0);

  const coldEmailCounts = {
    sent: 7230,
    opened: 2845,
    clicked: 612,
    replied: 214,
    meeting: 48,
    closed: 5,
  };
  const linkedinCounts = {
    connection_sent: 1240,
    accepted: 468,
    messaged: 312,
    replied: 104,
    meeting: 27,
    closed: 3,
  };
  const upworkCounts = {
    applied: 812,
    viewed: 221,
    replied: 72,
    hired: 11,
    revenue: 4,
  };
  const websiteCounts = {
    submitted: 132,
    contacted: 98,
    meeting: 42,
    closed: 8,
  };

  return (
    <>
      <PageHeader
        title="Overview"
        description="Live pipeline state, team performance, and funnel diagnostics."
        actions={
          <>
            <Select defaultValue="30d">
              <SelectTrigger size="sm" className="w-32">
                <Calendar className="h-3.5 w-3.5 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="qtd">Quarter to date</SelectItem>
                <SelectItem value="ytd">Year to date</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm">
              <Filter className="h-3.5 w-3.5 mr-1.5" /> Filter
            </Button>
            <Button variant="outline" size="sm">
              <Download className="h-3.5 w-3.5 mr-1.5" /> Export
            </Button>
          </>
        }
      />

      <PageBody>
        {!isDemo && leads.length === 0 ? (
          <div className="py-8">
            <WorkspaceEmptyHint
              title="Your workspace is empty"
              description="Charts and scorecards need leads and deals. Use Demo mode to see how everything fits together, then switch back when your data is connected."
            />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <KpiCard
                label="Open leads"
                value={totalOpen}
                hint="Across 7 channels"
                delta={12.4}
                icon={Target}
              />
              <KpiCard
                label="Pipeline value"
                value={`$${(pipelineValue / 1000).toFixed(0)}k`}
                hint={`${deals.filter((d) => !["won", "lost"].includes(d.stage)).length} open deals`}
                delta={8.1}
                icon={TrendingUp}
              />
              <KpiCard
                label="Closed (30d)"
                value={`$${(closedValue / 1000).toFixed(0)}k`}
                hint={`${deals.filter((d) => d.stage === "won").length} deals won`}
                delta={-4.2}
                icon={DollarSign}
              />
              <KpiCard
                label="Avg response"
                value={`${avgResponseMin.toFixed(0)}m`}
                hint="Time to first outbound"
                delta={-18.3}
                deltaType="positive-down"
                icon={Clock}
              />
              <KpiCard
                label="Idle leads"
                value={idleCount}
                hint="Over stage threshold"
                delta={21.0}
                deltaType="positive-down"
                icon={Inbox}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="min-w-0 lg:col-span-2">
                <TrendChart />
              </div>
              <PipelineDistribution />
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold">Channel funnels</h2>
                  <p className="text-xs text-muted-foreground">
                    Each channel&apos;s stage-by-stage conversion. Click any stage to drill into leads.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <FunnelChart channel="cold_email" title="Cold Email" counts={coldEmailCounts} />
                <FunnelChart channel="linkedin_outbound" title="LinkedIn Outbound" counts={linkedinCounts} />
                <FunnelChart channel="upwork" title="Upwork" counts={upworkCounts} />
                <FunnelChart channel="website_form" title="Website Form" counts={websiteCounts} />
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="xl:col-span-2 flex flex-col gap-4">
                <PersonScorecard />
                <ChannelMix />
              </div>
              <IdleLeads />
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}
