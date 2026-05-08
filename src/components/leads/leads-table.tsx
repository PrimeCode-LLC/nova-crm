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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
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
  Check,
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
  INTAKE_KIND_META,
} from "@/lib/constants";
import { StageBadge } from "@/components/common/stage-badge";
import { ChannelChip } from "@/components/common/channel-chip";
import { UserChip } from "@/components/common/user-chip";
import { fmtRelative, fmtDate, fmtCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useOpenQuickAdd } from "@/components/layout/quick-add-launcher";
import { downloadLeadsCsv } from "@/lib/leads-csv";
import {
  OWNER_SCOPE_PREFIX,
  buildPersonOwnerOptions,
  filterLeadsByOwnerScope,
  getOwnerFilterTriggerLabel,
} from "@/lib/owner-scope";
import { ReassignLeadsDialog } from "@/components/leads/reassign-leads-dialog";
import { useChannelAdminStore } from "@/stores/channel-admin-store";
import {
  DateRangeFilter,
  isWithinRange,
  type DateRange,
} from "@/components/common/date-range-filter";

/** Column filter token: leads with no outreach profile assigned. */
const PROFILE_FILTER_NONE = "__none__";

/** Column filter token: leads with no workspace labels. */
const LABEL_FILTER_NONE = "__unlabeled__";

function buildLeadsChannelOptions(customChannels: { id: string; name: string }[]) {
  return [
    ...CHANNEL_LIST.map((c) => ({ key: c.key, label: c.label })),
    ...customChannels
      .map((c) => ({ key: `custom_${c.id}`, label: c.name.trim() }))
      .filter((c) => c.label.length > 0),
  ];
}

function LeadChannelCell({ lead }: { lead: Lead }) {
  const { patchLead, bumpLeadActivity } = useWorkspace();
  const customChannels = useChannelAdminStore((s) => s.customChannels);
  const channelOptions = React.useMemo(
    () => buildLeadsChannelOptions(customChannels),
    [customChannels],
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            type="button"
            size="sm"
            className="h-auto gap-1 px-1 py-0 font-normal hover:bg-muted/60"
            onClick={(e) => e.stopPropagation()}
            aria-label="Change channel"
          >
            <ChannelChip channel={lead.channel} />
            <ChevronDown className="h-3 w-3 shrink-0 opacity-50" aria-hidden />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Set channel</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuGroup>
          {channelOptions.map((c) => (
            <DropdownMenuItem
              key={c.key}
              onClick={(e) => {
                e.stopPropagation();
                if (c.key === lead.channel) return;
                patchLead(lead.id, { channel: c.key as ChannelKey });
                bumpLeadActivity(lead.id);
                toast.success("Channel updated");
              }}
            >
              <span className="flex w-full min-w-0 items-center gap-2">
                <span className="flex w-4 shrink-0 justify-center">
                  {c.key === lead.channel ? <Check className="h-3.5 w-3.5" /> : null}
                </span>
                <ChannelChip channel={c.key} compact className="shrink-0" />
                <span className="min-w-0 truncate">{c.label}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LeadStageCell({ lead }: { lead: Lead }) {
  const { updateLeadStage, bumpLeadActivity, currentUserId } = useWorkspace();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            type="button"
            size="sm"
            className="h-auto gap-1 px-1 py-0 font-normal hover:bg-muted/60"
            onClick={(e) => e.stopPropagation()}
            aria-label="Change stage"
          >
            <StageBadge stage={lead.stage} />
            <ChevronDown className="h-3 w-3 shrink-0 opacity-50" aria-hidden />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Set stage</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuGroup>
          {PIPELINE_STAGES.map((s) => (
            <DropdownMenuItem
              key={s.key}
              onClick={(e) => {
                e.stopPropagation();
                if (s.key === lead.stage) return;
                updateLeadStage(lead.id, s.key, lead.stage, currentUserId);
                bumpLeadActivity(lead.id);
                toast.success(`Stage → ${s.label}`);
              }}
            >
              <span className="flex w-full min-w-0 items-center gap-2">
                <span className="flex w-4 shrink-0 justify-center">
                  {s.key === lead.stage ? <Check className="h-3.5 w-3.5" /> : null}
                </span>
                <StageBadge stage={s.key} className="shrink-0" />
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
  initialChannels: string[],
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
  /** Default intake filter (e.g. prospects-only page). */
  initialIntakeScope?: "all" | "prospect" | "sales_lead";
  /** When set, intake scope is fixed (toolbar control hidden) — e.g. Leads vs Prospects routes. */
  lockedIntakeScope?: "all" | "prospect" | "sales_lead";
}

export const LeadsTable = React.forwardRef<LeadsTableRef, LeadsTableProps>(function LeadsTable(
  {
    leads,
    preset = "default",
    urlChannelKey = "",
    urlStageKey = "",
    idleOnly = false,
    initialIntakeScope = "all",
    lockedIntakeScope,
  },
  ref,
) {
  const router = useRouter();
  const {
    currentUserId,
    users,
    getUserById,
    getOwnerDisplayName,
    getProfileById,
    profiles,
    crmLabels,
    isDemo,
  } = useWorkspace();
  const { openQuickAdd, openNewProspectForm } = useOpenQuickAdd();
  const customChannels = useChannelAdminStore((s) => s.customChannels);
  const leadsChannelFilterOptions = React.useMemo(
    () => buildLeadsChannelOptions(customChannels),
    [customChannels],
  );
  const initialChannels = React.useMemo(
    () => (urlChannelKey ? urlChannelKey.split("|").filter(Boolean) : []),
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
  const [columnVisibility, setColumnVisibility] = React.useState<Record<string, boolean>>({
    profileId: false,
  });
  const [ownerScope, setOwnerScope] = React.useState("all-owners");
  const [createdRange, setCreatedRange] = React.useState<DateRange | undefined>();
  const [activityRange, setActivityRange] = React.useState<DateRange | undefined>();
  const [intakeScope, setIntakeScope] = React.useState<"all" | "prospect" | "sales_lead">(
    lockedIntakeScope ?? initialIntakeScope,
  );
  const [reassignOpen, setReassignOpen] = React.useState(false);

  const effectiveIntakeScope = lockedIntakeScope ?? intakeScope;

  React.useEffect(() => {
    if (lockedIntakeScope) {
      setIntakeScope(lockedIntakeScope);
      return;
    }
    setIntakeScope(initialIntakeScope);
  }, [initialIntakeScope, lockedIntakeScope]);
  const [reassignLeadIds, setReassignLeadIds] = React.useState<string[]>([]);

  const openReassignForIds = React.useCallback((ids: string[]) => {
    setReassignLeadIds(ids);
    setReassignOpen(true);
  }, []);

  React.useEffect(() => {
    setColumnFilters(mergeUrlColumnFilters(preset, initialChannels, initialStages));
  }, [urlChannelKey, urlStageKey, preset, initialChannels, initialStages]);

  const afterIdleFilter = React.useMemo(
    () => (idleOnly ? leads.filter((l) => l.isIdle) : leads),
    [leads, idleOnly],
  );

  const ownerScopeDeps = React.useMemo(
    () => ({ currentUserId, users, getUserById, getOwnerDisplayName }),
    [currentUserId, users, getUserById, getOwnerDisplayName],
  );

  const personOwnerOptions = React.useMemo(
    () => buildPersonOwnerOptions(leads, users, getUserById, getOwnerDisplayName),
    [leads, users, getUserById, getOwnerDisplayName],
  );

  const profileFilterOptions = React.useMemo(() => {
    return [...profiles]
      .filter((p) => p.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [profiles]);

  const labelFilterOptions = React.useMemo(
    () => [...crmLabels].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [crmLabels],
  );

  const dataForTable = React.useMemo(() => {
    let rows = filterLeadsByOwnerScope(afterIdleFilter, ownerScope, ownerScopeDeps);
    if (effectiveIntakeScope === "prospect") {
      rows = rows.filter((l) => l.intakeKind === "prospect");
    } else if (effectiveIntakeScope === "sales_lead") {
      rows = rows.filter((l) => !l.intakeKind || l.intakeKind === "sales_lead");
    }
    if (createdRange?.from || createdRange?.to) {
      rows = rows.filter((l) => isWithinRange(l.createdAt, createdRange));
    }
    if (activityRange?.from || activityRange?.to) {
      rows = rows.filter((l) =>
        isWithinRange(l.lastActivityAt ?? l.updatedAt, activityRange),
      );
    }
    return rows;
  }, [afterIdleFilter, ownerScope, ownerScopeDeps, createdRange, activityRange, effectiveIntakeScope]);

  const ownerFilterTriggerLabel = React.useMemo(
    () => getOwnerFilterTriggerLabel(ownerScope, personOwnerOptions),
    [ownerScope, personOwnerOptions],
  );

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
      id: "intakeKind",
      accessorFn: (row) => row.intakeKind ?? "sales_lead",
      header: "Intake",
      cell: ({ row }) => {
        const k = row.original.intakeKind ?? "sales_lead";
        const m = INTAKE_KIND_META[k];
        return (
          <Badge variant="outline" className={cn("text-[10px] font-normal", m.className)}>
            {m.short}
          </Badge>
        );
      },
    },
    {
      id: "labelIds",
      accessorFn: (row) => (row.labelIds ?? []).join(","),
      header: "Labels",
      cell: ({ row }) => {
        const ids = row.original.labelIds ?? [];
        if (!ids.length) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        return (
          <div className="flex max-w-[148px] flex-wrap gap-0.5">
            {ids.slice(0, 4).map((id) => {
              const def = crmLabels.find((l) => l.id === id);
              return (
                <Badge
                  key={id}
                  variant="outline"
                  className="max-w-[7rem] truncate text-[9px] font-normal"
                  title={def?.name ?? id}
                  style={
                    def?.color
                      ? { borderLeftWidth: 2, borderLeftColor: def.color, borderLeftStyle: "solid" as const }
                      : undefined
                  }
                >
                  {def?.name ?? id.slice(0, 8)}
                </Badge>
              );
            })}
            {ids.length > 4 ? (
              <span className="self-center text-[10px] text-muted-foreground tabular-nums">+{ids.length - 4}</span>
            ) : null}
          </div>
        );
      },
      filterFn: (row, _id, value: string[]) => {
        const selected = value as string[];
        if (!selected?.length) return true;
        const leadIds = row.original.labelIds ?? [];
        const wantsUnlabeled = selected.includes(LABEL_FILTER_NONE);
        const labelIdsOnly = selected.filter((v) => v !== LABEL_FILTER_NONE);
        const unlabeledMatch = wantsUnlabeled && leadIds.length === 0;
        const tagMatch = labelIdsOnly.some((lid) => leadIds.includes(lid));
        return unlabeledMatch || tagMatch;
      },
    },
    {
      id: "channel",
      accessorKey: "channel",
      header: "Channel",
      cell: ({ row }) => <LeadChannelCell lead={row.original} />,
      filterFn: (row, id, value: string[]) =>
        !value?.length || value.includes(row.getValue<string>(id)),
    },
    {
      id: "profileId",
      accessorKey: "profileId",
      header: "Profile",
      cell: ({ row }) => {
        const p = getProfileById(row.original.profileId);
        if (!p) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        return (
          <span className="max-w-[10rem] truncate text-sm" title={p.name}>
            {p.name}
          </span>
        );
      },
      filterFn: (row, _id, value: string[]) => {
        const selected = value as string[];
        if (!selected?.length) return true;
        const pid = row.original.profileId;
        const wantsNone = selected.includes(PROFILE_FILTER_NONE);
        const profileIds = selected.filter((v) => v !== PROFILE_FILTER_NONE);
        if (wantsNone && !pid) return true;
        if (pid && profileIds.includes(pid)) return true;
        return false;
      },
    },
    {
      id: "stage",
      accessorKey: "stage",
      header: "Stage",
      cell: ({ row }) => <LeadStageCell lead={row.original} />,
      filterFn: (row, id, value: string[]) =>
        !value?.length || value.includes(row.getValue<string>(id)),
    },
    {
      id: "owner",
      accessorKey: "ownerId",
      header: "Owner",
      cell: ({ row }) => {
        const oid = row.original.ownerId?.trim();
        if (!oid) {
          return (
            <Badge variant="secondary" className="text-[10px] font-normal">
              Open queue
            </Badge>
          );
        }
        return <UserChip userId={oid} size="xs" />;
      },
    },
    {
      id: "addedBy",
      accessorFn: (row) => row.createdById ?? "",
      header: "Added by",
      cell: ({ row }) => {
        const id = row.original.createdById?.trim();
        if (!id) return <span className="text-xs text-muted-foreground">—</span>;
        return <UserChip userId={id} size="xs" />;
      },
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
      id: "created",
      accessorKey: "createdAt",
      header: "Added date",
      cell: ({ row }) => (
        <span
          className="text-xs text-muted-foreground tabular-nums whitespace-nowrap"
          title={fmtDate(row.original.createdAt, "PPpp")}
        >
          {fmtDate(row.original.createdAt)}
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
                onClick={(e) => {
                  e.stopPropagation();
                  openReassignForIds([id]);
                }}
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
  ], [router, openReassignForIds, isDemo, getProfileById, crmLabels]);

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
  }, [ownerScope, effectiveIntakeScope]);

  const selectedCount = Object.keys(rowSelection).length;
  const stageFilter = (columnFilters.find((f) => f.id === "stage")?.value as string[]) ?? [];
  const channelFilter = (columnFilters.find((f) => f.id === "channel")?.value as string[]) ?? [];
  const profileFilter = (columnFilters.find((f) => f.id === "profileId")?.value as string[]) ?? [];
  const labelFilter = (columnFilters.find((f) => f.id === "labelIds")?.value as string[]) ?? [];

  function toggleStage(key: PipelineStage) {
    const next = stageFilter.includes(key)
      ? stageFilter.filter((s) => s !== key)
      : [...stageFilter, key];
    table.getColumn("stage")?.setFilterValue(next.length ? next : undefined);
  }
  function toggleChannel(key: string) {
    const next = channelFilter.includes(key)
      ? channelFilter.filter((s) => s !== key)
      : [...channelFilter, key];
    table.getColumn("channel")?.setFilterValue(next.length ? next : undefined);
  }
  function toggleProfile(key: string) {
    const next = profileFilter.includes(key)
      ? profileFilter.filter((s) => s !== key)
      : [...profileFilter, key];
    table.getColumn("profileId")?.setFilterValue(next.length ? next : undefined);
  }
  function toggleLabelFilter(key: string) {
    const next = labelFilter.includes(key)
      ? labelFilter.filter((s) => s !== key)
      : [...labelFilter, key];
    table.getColumn("labelIds")?.setFilterValue(next.length ? next : undefined);
  }

  return (
    <div className="flex flex-col gap-3">
      <ReassignLeadsDialog
        open={reassignOpen}
        onOpenChange={(o) => {
          setReassignOpen(o);
          if (!o) setReassignLeadIds([]);
        }}
        leadIds={reassignLeadIds}
        onSuccess={() => setRowSelection({})}
      />
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

        {lockedIntakeScope ? (
          <span
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 text-xs text-muted-foreground"
            title="Intake filter is fixed on this page"
          >
            <Filter className="h-3.5 w-3.5" aria-hidden />
            {lockedIntakeScope === "sales_lead"
              ? "Sales leads"
              : lockedIntakeScope === "prospect"
                ? "Prospects"
                : "All records"}
          </span>
        ) : (
          <Select value={intakeScope} onValueChange={(v) => v && setIntakeScope(v as typeof intakeScope)}>
            <SelectTrigger size="sm" className="w-[min(168px,42vw)] min-w-0 gap-1.5">
              <Filter className="h-3.5 w-3.5 shrink-0 opacity-60" />
              <SelectValue placeholder="Intake" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All records</SelectItem>
              <SelectItem value="prospect">Prospects only</SelectItem>
              <SelectItem value="sales_lead">Sales leads only</SelectItem>
            </SelectContent>
          </Select>
        )}

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
            {leadsChannelFilterOptions.map((c) => (
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

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="gap-1.5">
                <Filter className="h-3.5 w-3.5" />
                Profile
                {profileFilter.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                    {profileFilter.length}
                  </Badge>
                )}
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Outreach persona
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuCheckboxItem
              checked={profileFilter.includes(PROFILE_FILTER_NONE)}
              onCheckedChange={() => toggleProfile(PROFILE_FILTER_NONE)}
            >
              No profile
            </DropdownMenuCheckboxItem>
            {profileFilterOptions.length > 0 && <DropdownMenuSeparator />}
            {profileFilterOptions.map((p) => {
              const chLabel = CHANNEL_LIST.find((c) => c.key === p.channel)?.label ?? p.channel;
              return (
                <DropdownMenuCheckboxItem
                  key={p.id}
                  checked={profileFilter.includes(p.id)}
                  onCheckedChange={() => toggleProfile(p.id)}
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="truncate text-[10px] font-normal text-muted-foreground">{chLabel}</span>
                  </span>
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="gap-1.5">
                <Tag className="h-3.5 w-3.5" />
                Labels
                {labelFilter.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                    {labelFilter.length}
                  </Badge>
                )}
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Show leads that match any selected tag
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuCheckboxItem
              checked={labelFilter.includes(LABEL_FILTER_NONE)}
              onCheckedChange={() => toggleLabelFilter(LABEL_FILTER_NONE)}
            >
              Unlabeled
            </DropdownMenuCheckboxItem>
            {labelFilterOptions.length > 0 && <DropdownMenuSeparator />}
            {labelFilterOptions.map((l) => (
              <DropdownMenuCheckboxItem
                key={l.id}
                checked={labelFilter.includes(l.id)}
                onCheckedChange={() => toggleLabelFilter(l.id)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: l.color ?? "hsl(var(--muted-foreground))" }}
                  />
                  <span className="truncate">{l.name}</span>
                </span>
              </DropdownMenuCheckboxItem>
            ))}
            {labelFilterOptions.length === 0 && (
              <div className="px-2 py-2 text-xs text-muted-foreground">No labels defined yet.</div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DateRangeFilter
          label="Added"
          value={createdRange}
          onChange={setCreatedRange}
        />
        <DateRangeFilter
          label="Last activity"
          value={activityRange}
          onChange={setActivityRange}
        />

        <Select value={ownerScope} onValueChange={(v) => setOwnerScope(v ?? "all-owners")}>
          <SelectTrigger size="sm" className="min-w-[9.5rem] max-w-[13rem]">
            <SelectValue placeholder="Owner filter">
              {ownerFilterTriggerLabel}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectGroup>
              <SelectLabel className="text-[10px] uppercase tracking-wide">Quick</SelectLabel>
              <SelectItem value="all-owners">All owners</SelectItem>
              <SelectItem value="me">Owned by me</SelectItem>
              <SelectItem value="team">My team</SelectItem>
              <SelectItem value="open-queue">Open queue</SelectItem>
              <SelectItem value="unassigned">Orphan owner</SelectItem>
            </SelectGroup>
            {personOwnerOptions.length > 0 && (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel className="text-[10px] uppercase tracking-wide">By teammate</SelectLabel>
                  {personOwnerOptions.map((o) => (
                    <SelectItem key={o.id} value={`${OWNER_SCOPE_PREFIX}${o.id}`}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            )}
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
            variant="outline"
            size="sm"
            type="button"
            onClick={() => openNewProspectForm()}
          >
            <Plus className="h-3.5 w-3.5" /> New prospect
          </Button>
          <Button size="sm" type="button" onClick={() => openQuickAdd({ initialPill: "lead" })}>
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
            onClick={() => {
              const ids = table.getSelectedRowModel().rows.map((r) => r.original.id);
              if (!ids.length) return;
              openReassignForIds(ids);
            }}
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
