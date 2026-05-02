"use client";

import * as React from "react";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { KanbanBoard } from "@/components/leads/kanban-board";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useOpenQuickAdd } from "@/components/layout/quick-add-launcher";
import { Plus, Table as TableIcon, Filter } from "lucide-react";
import Link from "next/link";
import { PRIORITY_TONE } from "@/lib/constants";
import type { LeadPriority } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function PipelinePage() {
  const { leads, isDemo } = useWorkspace();
  const { openQuickAdd } = useOpenQuickAdd();
  const [boardQuery, setBoardQuery] = React.useState("");
  const [priorityFilter, setPriorityFilter] = React.useState<LeadPriority[]>([]);

  const hasActiveFilters =
    boardQuery.trim().length > 0 || priorityFilter.length > 0;

  return (
    <>
      <PageHeader
        title="Pipeline"
        description="Drag leads between stages. Stage-required fields validate on drop."
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className={hasActiveFilters ? "border-primary/40 bg-primary/5" : undefined}
                  >
                    <Filter className="h-3.5 w-3.5" /> Filter
                    {hasActiveFilters ? (
                      <span className="sr-only">(filters active)</span>
                    ) : null}
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-72 p-2">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  Search this board
                </DropdownMenuLabel>
                <Input
                  className="h-8 text-sm"
                  placeholder="Contact or company…"
                  value={boardQuery}
                  onChange={(e) => setBoardQuery(e.target.value)}
                />
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  Priority (match any)
                </DropdownMenuLabel>
                {(Object.keys(PRIORITY_TONE) as LeadPriority[]).map((key) => (
                  <DropdownMenuCheckboxItem
                    key={key}
                    checked={priorityFilter.includes(key)}
                    onCheckedChange={(checked) => {
                      setPriorityFilter((prev) => {
                        if (checked) return prev.includes(key) ? prev : [...prev, key];
                        return prev.filter((p) => p !== key);
                      });
                    }}
                  >
                    {PRIORITY_TONE[key].label}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full text-xs"
                  disabled={!hasActiveFilters}
                  onClick={() => {
                    setBoardQuery("");
                    setPriorityFilter([]);
                  }}
                >
                  Clear filters
                </Button>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link href="/leads">
                  <TableIcon className="h-3.5 w-3.5" /> Table
                </Link>
              }
            />
            <Button size="sm" onClick={() => openQuickAdd({ initialPill: "lead" })}>
              <Plus className="h-3.5 w-3.5" /> New lead
            </Button>
          </>
        }
      />
      <PageBody>
        {!isDemo && leads.length === 0 ? (
          <WorkspaceEmptyHint title="No leads to show on the board" />
        ) : (
          <KanbanBoard
            leads={leads}
            boardFilter={{ query: boardQuery, priorities: priorityFilter }}
            onAddToStage={(stage) =>
              openQuickAdd({ initialPill: "lead", initialLeadStage: stage })
            }
          />
        )}
      </PageBody>
    </>
  );
}
