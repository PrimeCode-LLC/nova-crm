"use client";

import * as React from "react";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KpiCard } from "@/components/common/kpi-card";
import { StageBadge } from "@/components/common/stage-badge";
import { UserChip } from "@/components/common/user-chip";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { Plus, Search, DollarSign, TrendingUp, Trophy, Target } from "lucide-react";

export default function DealsPage() {
  const { deals, isDemo } = useWorkspace();
  const [query, setQuery] = React.useState("");
  const filtered = deals.filter((d) => !query || d.name.toLowerCase().includes(query.toLowerCase()));

  const openDeals = deals.filter((d) => !["won", "lost"].includes(d.stage));
  const pipelineValue = openDeals.reduce((s, d) => s + d.value, 0);
  const weighted = openDeals.reduce((s, d) => s + (d.value * d.probability) / 100, 0);
  const won = deals.filter((d) => d.stage === "won");
  const wonValue = won.reduce((s, d) => s + d.value, 0);

  return (
    <>
      <PageHeader
        title="Deals"
        description="Every qualified opportunity, with value and expected close."
        actions={
          <Button size="sm">
            <Plus className="h-3.5 w-3.5" /> New deal
          </Button>
        }
      />
      <PageBody>
        {!isDemo && deals.length === 0 ? (
          <WorkspaceEmptyHint title="No deals in workspace" />
        ) : (
          <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="Open deals" value={openDeals.length} icon={Target} />
          <KpiCard label="Pipeline" value={fmtCurrency(pipelineValue)} hint="Total open value" icon={TrendingUp} />
          <KpiCard label="Weighted" value={fmtCurrency(weighted)} hint="Probability-adjusted" icon={DollarSign} />
          <KpiCard
            label="Closed won"
            value={fmtCurrency(wonValue)}
            hint={`${won.length} deals`}
            icon={Trophy}
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search deals…"
              className="pl-8 h-8"
            />
          </div>
        </div>

        <div className="rounded-md border overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9">Deal</TableHead>
                  <TableHead className="h-9">Stage</TableHead>
                  <TableHead className="h-9 text-right">Value</TableHead>
                  <TableHead className="h-9 text-right">Probability</TableHead>
                  <TableHead className="h-9 text-right">Weighted</TableHead>
                  <TableHead className="h-9">Close date</TableHead>
                  <TableHead className="h-9">Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="py-2">
                      <Link href={`/deals/${d.id}`} className="text-sm font-medium hover:text-primary">
                        {d.name}
                      </Link>
                    </TableCell>
                    <TableCell className="py-2"><StageBadge stage={d.stage} /></TableCell>
                    <TableCell className="py-2 text-right tabular-nums font-semibold">
                      {fmtCurrency(d.value, d.currency)}
                    </TableCell>
                    <TableCell className="py-2 text-right tabular-nums text-muted-foreground">
                      {d.probability}%
                    </TableCell>
                    <TableCell className="py-2 text-right tabular-nums">
                      {fmtCurrency((d.value * d.probability) / 100, d.currency)}
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">
                      {fmtDate(d.expectedCloseDate, "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="py-2">
                      <UserChip userId={d.ownerId} size="xs" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
          </>
        )}
      </PageBody>
    </>
  );
}
