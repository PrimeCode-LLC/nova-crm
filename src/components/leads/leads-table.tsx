"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
  ColumnFiltersState,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  ArrowUpDown,
  ChevronDown,
  Columns3,
  Filter,
  MoreHorizontal,
  Search,
  Plus,
  Trash2,
  Tag,
  UserCog,
} from "lucide-react";
import type { Lead, PipelineStage, ChannelKey, LeadTemperature } from "@/lib/types";
import {
  PIPELINE_STAGES,
  CHANNEL_LIST,
  TEMPERATURE_TONE,
  PRIORITY_TONE,
  PUSH_STATUS_TONE,
} from "@/lib/constants";
import { StageBadge } from "@/components/common/stage-badge";
import { ChannelChip } from "@/components/common/channel-chip";
import { UserChip } from "@/components/common/user-chip";
import { fmtRelative, fmtDate, fmtCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useOpenQuickAdd } from "@/components/layout/quick-add-launcher";
import { downloadLeadsCsv } from "@/lib/leads-csv";

export type LeadsTablePreset = "default" | "high-priority";

export type LeadsTableRef = {
  /** Downloads CSV for rows currently visible after toolbar filters (search, stage, channel, priority preset, etc.). */
  exportFilteredCsv: () => void;
};

function initialColumnFiltersForPreset(preset: LeadsTablePreset | undefined): ColumnFiltersState {
  if (preset === "high-priority") {
    return [{ id: "priority", value: ["high", "urgent"] }];
  }
  return [];
}

function mergeUrlColumnFilters(
  preset: LeadsTablePreset | undefined,
  initialChannels: ChannelKey[],
  initialStages: PipelineStage[],
): ColumnFiltersState {
  const out = initialColumnFiltersForPreset(preset);
  if (initialChannels.length) out.push({ id: "channel", value: [...initialChannels] });
  if (initialStages.length) out.push({ id: "stage", value: [...initialStages] });
  return out;
}

export interface LeadsTableProps {
  leads: Lead[];
  preset?: LeadsTablePreset;
  /** Sorted `channel` query values joined with `|` (stable for effects). */
  urlChannelKey?: string;
  /** Sorted `stage` query values joined with `|` (stable for effects). */
  urlStageKey?: string;
  idleOnly?: boolean;
}

export const LeadsTable = React.forwardRef<LeadsTableRef, LeadsTableProps>(function LeadsTable(
  { leads, preset = "default", urlChannelKey = "", urlStageKey = "", idleOnly = false },
  ref,
) {
  const router = useRouter();
  const { currentUserId, users, getUserById, isDemo } = useWorkspace();
  const { openQuickAdd } = useOpenQuickAdd();
  const initialChannels = React.useMemo(
    () => (urlChannelKey ? (urlChannelKey.split("|").filter(Boolean) as ChannelKey[]) : []),
    [urlChannelKey],
  );
  const initialStages = React.useMemo(
    () => (urlStageKey ? (urlStageKey.split("|").filter(Boolean) as PipelineStage[]) : []),
    [urlStageKey],
  );
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(() =>
    mergeUrlColumnFilters(preset, initialChannels, initialStages),
  );
  const [rowSelection, setRowSelection] = React.useState({});
  const [columnVisibility, setColumnVisibility] = React.useState<Record<string, boolean>>({});
  const [ownerScope, setOwnerScope] = React.useState("all-owners");

  React.useEffect(() => {
    setColumnFilters(mergeUrlColumnFilters(preset, initialChannels, initialStages));
  }, [urlChannelKey, urlStageKey, preset, initialChannels, initialStages]);

  const afterIdleFilter = React.useMemo(
    () => (idleOnly ? leads.filter((l) => l.isIdle) : leads),
    [leads, idleOnly],
  );

  const dataForTable = React.useMemo(() => {
    if (ownerScope === "all-owners") return afterIdleFilter;
    if (ownerScope === "me") return afterIdleFilter.filter((l) => l.ownerId === currentUserId);
    if (ownerScope === "unassigned") {
      return afterIdleFilter.filter((l) => !l.ownerId || !getUserById(l.ownerId));
    }
    if (ownerScope === "team") {
      const peerIds = new Set(users.filter((u) => u.id !== currentUserId).map((u) => u.id));
      return afterIdleFilter.filter((l) => peerIds.has(l.ownerId));
    }
    return afterIdleFilter;
  }, [afterIdleFilter, ownerScope, currentUserId, users, getUserById]);

  const columns = React.useMemo<ColumnDef<Lead>[]>(() => [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllRowsSelected()}
          indeterminate={table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected()}
          onCheckedChange={(v) => table.toggleAllRowsSelected(!!v)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          aria-label="Select row"
          onClick={(e) => e.stopPropagation()}
        />
      ),
      enableSorting: false,
      size: 32,
    },
    {
      id: "contact",
      accessorKey: "contactName",
      header: "Contact",
      cell: ({ row }) => (
        <div className="min-w-0">
          <Link
            href={`/leads/${row.original.id}`}
            className="text-sm font-medium hover:text-primary truncate block"
          >
            {row.original.contactName}
          </Link>
          {row.original.contactTitle && (
            <div className="text-xs text-muted-foreground truncate">
              {row.original.contactTitle}
            </div>
          )}
        </div>
      ),
    },
    {
      id: "company",
      accessorKey: "companyName",
      header: "Company",
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="text-sm truncate">{row.original.companyName}</div>
          {row.original.companyIndustry && (
            <div className="text-xs text-muted-foreground truncate">
              {row.original.companyIndustry}
            </div>
          )}
        </div>
      ),
    },
    {
      id: "channel",
      accessorKey: "channel",
      header: "Channel",
      cell: ({ row }) => <ChannelChip channel={row.original.channel} />,
      filterFn: (row, id, value: string[]) =>
        !value?.length || value.includes(row.getValue<string>(id)),
    },
    {
      id: "stage",
      accessorKey: "stage",
      header: "Stage",
      cell: ({ row }) => <StageBadge stage={row.original.stage} />,
      filterFn: (row, id, value: string[]) =>
        !value?.length || value.includes(row.getValue<string>(id)),
    },
    {
      id: "owner",
      accessorKey: "ownerId",
      header: "Owner",
      cell: ({ row }) => <UserChip userId={row.original.ownerId} size="xs" />,
    },
    {
      id: "temperature",
      accessorKey: "temperature",
      header: "Temp",
      cell: ({ row }) => {
        const t = TEMPERATURE_TONE[row.original.temperature];
        return (
          <Badge variant="outline" className={cn("rounded-md", t.className)}>
            {t.label}
          </Badge>
        );
      },
    },
    {
      id: "priority",
      accessorKey: "priority",
      header: "Priority",
      cell: ({ row }) => {
        const p = PRIORITY_TONE[row.original.priority];
        return <Badge className={cn("rounded-md border-transparent", p.className)}>{p.label}</Badge>;
      },
      filterFn: (row, id, value: string[]) =>
        !value?.length || value.includes(row.getValue<string>(id)),
    },
    {
      id: "push",
      accessorFn: (r) => r.pushToInstantly ?? r.pushToLinkedIn ?? "not_ready",
      header: "Push",
      cell: ({ row }) => {
        const v = row.original.pushToInstantly ?? row.original.pushToLinkedIn;
        if (!v) return <span className="text-xs text-muted-foreground">-</span>;
        const t = PUSH_STATUS_TONE[v];
        return (
          <Badge variant="outline" className={cn("rounded-md", t.className)}>
            {t.label}
          </Badge>
        );
      },
    },
    {
      id: "value",
      accessorKey: "estimatedValue",
      header: () => <span className="tabular-nums">Value</span>,
      cell: ({ row }) => (
        <span className="tabular-nums text-right block">
          {fmtCurrency(row.original.estimatedValue)}
        </span>
      ),
    },
    {
      id: "idle",
      accessorKey: "idleDays",
      header: "Idle",
      cell: ({ row }) => {
        const days = row.original.idleDays ?? 0;
        const isIdle = row.original.isIdle;
        return (
          <Badge
            variant="outline"
            className={cn(
              "rounded-md tabular-nums",
              isIdle
                ? "bg-destructive/10 text-destructive border-destructive/20"
                : "bg-muted text-muted-foreground",
            )}
          >
            {days}d
          </Badge>
        );
      },
    },
    {
      id: "updated",
      accessorKey: "updatedAt",
      header: "Last activity",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
          {fmtRelative(row.original.lastActivityAt ?? row.original.updatedAt)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const id = row.original.id;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => router.push(`/leads/${id}`)}>Edit</DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  toast.info(isDemo ? "Demo workspace" : "Not yet available", {
                    description: isDemo
                      ? "Reassign is read-only in sample data."
                      : "Connect your backend to reassign owners.",
                  })
                }
              >
                Reassign
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push(`/leads/${id}?tab=notes`)}>
                Add note
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() =>
                  toast.info(isDemo ? "Demo workspace" : "Not yet available", {
                    description: isDemo
                      ? "Archiving is disabled in sample data."
                      : "Archive will be available once your workspace is connected.",
                  })
                }
              >
                Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
      enableSorting: false,
      size: 40,
    },
  ], [router, isDemo]);

  const table = useReactTable({
    data: dataForTable,
    columns,
    state: { sorting, globalFilter, columnFilters, rowSelection, columnVisibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _colId, filterValue) => {
      const q = String(filterValue ?? "").toLowerCase();
      if (!q) return true;
      return [
        row.original.contactName,
        row.original.companyName,
        row.original.contactEmail,
        row.original.companyDomain,
        row.original.contactTitle,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    },
  });

  React.useImperativeHandle(
    ref,
    () => ({
      exportFilteredCsv: () => {
        const rows = table.getFilteredRowModel().rows.map((r) => r.original);
        if (!rows.length) {
          toast.message("Nothing to export", {
            description: "Adjust filters or add leads first.",
          });
          return;
        }
        downloadLeadsCsv(rows);
        toast.success("Exported", { description: `${rows.length} lead(s) downloaded as CSV.` });
      },
    }),
    [table],
  );

  React.useEffect(() => {
    setRowSelection({});
  }, [ownerScope]);

  const selectedCount = Object.keys(rowSelection).length;
  const stageFilter = (columnFilters.find((f) => f.id === "stage")?.value as string[]) ?? [];
  const channelFilter = (columnFilters.find((f) => f.id === "channel")?.value as string[]) ?? [];

  function toggleStage(key: PipelineStage) {
    const next = stageFilter.includes(key)
      ? stageFilter.filter((s) => s !== key)
      : [...stageFilter, key];
    table.getColumn("stage")?.setFilterValue(next.length ? next : undefined);
  }
  function toggleChannel(key: ChannelKey) {
    const next = channelFilter.includes(key)
      ? channelFilter.filter((s) => s !== key)
      : [...channelFilter, key];
    table.getColumn("channel")?.setFilterValue(next.length ? next : undefined);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name, company, email…"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-8 h-8"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="gap-1.5">
                <Filter className="h-3.5 w-3.5" />
                Stage
                {stageFilter.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                    {stageFilter.length}
                  </Badge>
                )}
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-44">
            {PIPELINE_STAGES.map((s) => (
              <DropdownMenuCheckboxItem
                key={s.key}
                checked={stageFilter.includes(s.key)}
                onCheckedChange={() => toggleStage(s.key)}
              >
                {s.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="gap-1.5">
                <Filter className="h-3.5 w-3.5" />
                Channel
                {channelFilter.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                    {channelFilter.length}
                  </Badge>
                )}
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-48">
            {CHANNEL_LIST.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.key}
                checked={channelFilter.includes(c.key)}
                onCheckedChange={() => toggleChannel(c.key)}
              >
                {c.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Select value={ownerScope} onValueChange={(v) => setOwnerScope(v ?? "all-owners")}>
          <SelectTrigger size="sm" className="w-[8.5rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all-owners">All owners</SelectItem>
            <SelectItem value="me">Owned by me</SelectItem>
            <SelectItem value="team">My team</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Columns3 className="h-3.5 w-3.5" /> Columns
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Show columns</DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuGroup>
                {table
                  .getAllLeafColumns()
                  .filter((c) => !["select", "actions", "contact"].includes(c.id))
                  .map((col) => (
                    <DropdownMenuCheckboxItem
                      key={col.id}
                      checked={col.getIsVisible()}
                      onCheckedChange={(v) => col.toggleVisibility(!!v)}
                    >
                      {typeof col.columnDef.header === "string" ? col.columnDef.header : col.id}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            type="button"
            onClick={() => openQuickAdd({ initialPill: "lead" })}
          >
            <Plus className="h-3.5 w-3.5" /> New lead
          </Button>
        </div>
      </div>

      {/* Bulk actions bar */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-2 rounded-md border bg-accent/40 px-3 py-2 text-sm">
          <span className="font-medium">{selectedCount} selected</span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            type="button"
            onClick={() =>
              toast.info(isDemo ? "Demo workspace" : "Not yet available", {
                description: isDemo
                  ? "Bulk reassign is read-only in sample data."
                  : "Bulk reassign will be available once your workspace is connected.",
              })
            }
          >
            <UserCog className="h-3.5 w-3.5" /> Reassign
          </Button>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() =>
              toast.info(isDemo ? "Demo workspace" : "Not yet available", {
                description: isDemo
                  ? "Bulk tagging is read-only in sample data."
                  : "Bulk tags will be available once your workspace is connected.",
              })
            }
          >
            <Tag className="h-3.5 w-3.5" /> Tag
          </Button>
          <Button
            variant="destructive"
            size="sm"
            type="button"
            onClick={() =>
              toast.info(isDemo ? "Demo workspace" : "Not yet available", {
                description: isDemo
                  ? "Bulk archive is disabled in sample data."
                  : "Bulk archive will be available once your workspace is connected.",
              })
            }
          >
            <Trash2 className="h-3.5 w-3.5" /> Archive
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-md border overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <Table>
            <TableHeader className="bg-muted/30">
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="hover:bg-transparent border-b">
                  {hg.headers.map((h) => (
                    <TableHead
                      key={h.id}
                      className="text-xs font-semibold uppercase tracking-wide text-muted-foreground h-9 whitespace-nowrap"
                    >
                      {h.isPlaceholder ? null : (
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className="flex items-center gap-1 hover:text-foreground transition-colors"
                          disabled={!h.column.getCanSort()}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {h.column.getCanSort() && (
                            <ArrowUpDown className="h-3 w-3 opacity-40" />
                          )}
                        </button>
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-40 text-center text-muted-foreground">
                    No leads match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    className="cursor-pointer"
                    onClick={(e) => {
                      const el = e.target as HTMLElement;
                      if (el.closest("a, button, [data-slot='checkbox'], [data-slot='dropdown-menu-trigger']")) {
                        return;
                      }
                      router.push(`/leads/${row.original.id}`);
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="py-2 whitespace-nowrap">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Showing <span className="font-medium text-foreground tabular-nums">{table.getRowModel().rows.length}</span> of{" "}
          <span className="tabular-nums">{table.getCoreRowModel().rows.length}</span> leads
        </span>
      </div>
    </div>
  );
});

LeadsTable.displayName = "LeadsTable";
