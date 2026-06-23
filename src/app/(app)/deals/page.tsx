"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
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
import { Plus, Search, DollarSign, TrendingUp, Trophy, Target, ArrowUpDown } from "lucide-react";
import { STAGES_BY_KEY } from "@/lib/constants";
import type { Deal } from "@/lib/types";
import { useLocalDeals } from "@/hooks/use-local-deals";
import { recordDealCreatedClient } from "@/lib/firestore/audit-change-client";
import { cn } from "@/lib/utils";

const NewDealDialog = dynamic(
  () => import("@/components/deals/new-deal-dialog").then((m) => ({ default: m.NewDealDialog })),
  { ssr: false },
);

type SortKey = "name" | "stage" | "value" | "probability" | "weighted" | "close" | "owner";
type SortDir = "asc" | "desc";

function weightedValue(d: Deal): number {
  return (d.value * d.probability) / 100;
}

export default function DealsPage() {
  const router = useRouter();
  const ws = useWorkspace();
  const { localDeals, addLocalDeal } = useLocalDeals();
  const [query, setQuery] = React.useState("");
  const [sortKey, setSortKey] = React.useState<SortKey>("name");
  const [sortDir, setSortDir] = React.useState<SortDir>("asc");
  const [newOpen, setNewOpen] = React.useState(false);
  const [newDealFormKey, setNewDealFormKey] = React.useState(0);

  const handleCreateDeal = React.useCallback(
    (deal: Deal) => {
      addLocalDeal(deal);
      const lead = ws.getLeadById(deal.leadId);
      recordDealCreatedClient({
        dealId: deal.id,
        dealName: deal.name,
        leadId: deal.leadId,
        channel: lead?.channel,
      });
    },
    [addLocalDeal, ws],
  );

  const deals = React.useMemo(() => [...localDeals, ...ws.deals], [localDeals, ws.deals]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return deals;
    return deals.filter((d) => {
      const owner = ws.getUserById(d.ownerId);
      const ownerName = owner?.displayName?.toLowerCase() ?? "";
      const stageLabel = STAGES_BY_KEY[d.stage]?.label?.toLowerCase() ?? d.stage;
      const valueStr = fmtCurrency(d.value, d.currency).toLowerCase();
      return (
        d.name.toLowerCase().includes(q) ||
        stageLabel.includes(q) ||
        ownerName.includes(q) ||
        valueStr.includes(q) ||
        String(d.probability).includes(q)
      );
    });
  }, [deals, query, ws]);

  const sorted = React.useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "stage":
          cmp = a.stage.localeCompare(b.stage);
          break;
        case "value":
          cmp = a.value - b.value;
          break;
        case "probability":
          cmp = a.probability - b.probability;
          break;
        case "weighted":
          cmp = weightedValue(a) - weightedValue(b);
          break;
        case "close":
          cmp = a.expectedCloseDate.localeCompare(b.expectedCloseDate);
          break;
        case "owner": {
          const na = ws.getUserById(a.ownerId)?.displayName ?? "";
          const nb = ws.getUserById(b.ownerId)?.displayName ?? "";
          cmp = na.localeCompare(nb);
          break;
        }
        default:
          cmp = 0;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [filtered, sortKey, sortDir, ws]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const openDeals = deals.filter((d) => !["won", "lost"].includes(d.stage));
  const pipelineValue = openDeals.reduce((s, d) => s + d.value, 0);
  const weighted = openDeals.reduce((s, d) => s + weightedValue(d), 0);
  const won = deals.filter((d) => d.stage === "won");
  const wonValue = won.reduce((s, d) => s + d.value, 0);

  const listEmpty = !ws.isDemo && ws.deals.length === 0 && localDeals.length === 0;

  return (
    <>
      <PageHeader
        title="Deals"
        description="Every qualified opportunity, with value and expected close."
        actions={
          <Button
            size="sm"
            className="gap-1.5"
            type="button"
            onClick={() => {
              setNewDealFormKey((k) => k + 1);
              setNewOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" /> New deal
          </Button>
        }
      />
      <PageBody>
        {listEmpty ? (
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
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search deals..."
                  className="pl-8 h-8"
                  aria-label="Search deals"
                />
              </div>
            </div>

            <div className="rounded-md border overflow-hidden">
              <div className="overflow-x-auto scrollbar-thin">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow className="hover:bg-transparent">
                      {(
                        [
                          { key: "name" as const, label: "Deal", align: "left" },
                          { key: "stage" as const, label: "Stage", align: "left" },
                          { key: "value" as const, label: "Value", align: "right" },
                          { key: "probability" as const, label: "Probability", align: "right" },
                          { key: "weighted" as const, label: "Weighted", align: "right" },
                          { key: "close" as const, label: "Close date", align: "left" },
                          { key: "owner" as const, label: "Owner", align: "left" },
                        ] as const
                      ).map((col) => (
                        <TableHead key={col.key} className={cn("h-9", col.align === "right" && "text-right")}>
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key)}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md px-1 py-0.5 -mx-1 font-medium hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring/50 outline-none",
                              col.align === "right" ? "w-full justify-end" : "text-left",
                            )}
                            aria-label={`Sort by ${col.label}`}
                          >
                            {col.label}
                            <ArrowUpDown
                              className={cn(
                                "h-3 w-3 shrink-0 text-muted-foreground",
                                sortKey === col.key && "text-foreground",
                              )}
                            />
                          </button>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sorted.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                          No deals match your search.
                        </TableCell>
                      </TableRow>
                    ) : (
                      sorted.map((d) => (
                        <TableRow
                          key={d.id}
                          className="cursor-pointer"
                          onClick={() => router.push(`/deals/${d.id}`)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              router.push(`/deals/${d.id}`);
                            }
                          }}
                          tabIndex={0}
                          aria-label={`Open deal ${d.name}`}
                        >
                          <TableCell className="py-2">
                            <span className="text-sm font-medium text-primary">{d.name}</span>
                          </TableCell>
                          <TableCell className="py-2">
                            <StageBadge stage={d.stage} />
                          </TableCell>
                          <TableCell className="py-2 text-right tabular-nums font-semibold">
                            {fmtCurrency(d.value, d.currency)}
                          </TableCell>
                          <TableCell className="py-2 text-right tabular-nums text-muted-foreground">
                            {d.probability}%
                          </TableCell>
                          <TableCell className="py-2 text-right tabular-nums">
                            {fmtCurrency(weightedValue(d), d.currency)}
                          </TableCell>
                          <TableCell className="py-2 text-xs text-muted-foreground">
                            {fmtDate(d.expectedCloseDate, "MMM d, yyyy")}
                          </TableCell>
                          <TableCell className="py-2">
                            <UserChip userId={d.ownerId} size="xs" />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        )}
      </PageBody>

      {newOpen ? (
        <NewDealDialog
          key={newDealFormKey}
          open={newOpen}
          onOpenChange={setNewOpen}
          leads={ws.leads}
          users={ws.users}
          currentUserId={ws.currentUserId || ws.users[0]?.id || ""}
          getOwnerDisplayName={ws.getOwnerDisplayName}
          onCreate={handleCreateDeal}
        />
      ) : null}
    </>
  );
}
