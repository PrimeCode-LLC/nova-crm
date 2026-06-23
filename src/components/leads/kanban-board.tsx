"use client";

import * as React from "react";
import Link from "next/link";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KANBAN_STAGES, PIPELINE_STAGES, STAGES_BY_KEY, PRIORITY_TONE } from "@/lib/constants";
import type { Lead, LeadPriority, PipelineStage } from "@/lib/types";
import { ChannelChip } from "@/components/common/channel-chip";
import { UserChip } from "@/components/common/user-chip";
import { fmtCurrency, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AlertTriangle, Calendar, Plus } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";

type LeadMap = Record<PipelineStage, Lead[]>;

const stageIdSet = new Set<string>(KANBAN_STAGES as string[]);

/** Prefer pointer-based hits so column droppables register when moving between boards. */
const pipelineCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    const onCard = pointerCollisions.filter((c) => !stageIdSet.has(String(c.id)));
    if (onCard.length > 0) {
      return onCard;
    }
    return pointerCollisions;
  }
  return closestCorners(args);
};

function groupByStage(leads: Lead[]): LeadMap {
  const acc = Object.fromEntries(
    KANBAN_STAGES.map((s) => [s, [] as Lead[]]),
  ) as unknown as LeadMap;
  for (const l of leads) {
    if (KANBAN_STAGES.includes(l.stage)) {
      acc[l.stage].push(l);
    }
  }
  return acc;
}

export type PipelineBoardFilter = {
  query: string;
  /** When non-empty, only these priorities are shown. */
  priorities: LeadPriority[];
};

export function KanbanBoard({
  leads: initialLeads,
  boardFilter,
  onAddToStage,
}: {
  leads: Lead[];
  boardFilter?: PipelineBoardFilter;
  onAddToStage?: (stage: PipelineStage) => void;
}) {
  const { updateLeadStage, currentUserId } = useWorkspace();
  const [leads, setLeads] = React.useState(initialLeads);
  const [activeId, setActiveId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setLeads(initialLeads);
  }, [initialLeads]);

  const filteredLeads = React.useMemo(() => {
    const q = (boardFilter?.query ?? "").trim().toLowerCase();
    const pri = boardFilter?.priorities;
    return leads.filter((l) => {
      if (q) {
        const hay = `${l.contactName} ${l.companyName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (pri && pri.length > 0 && !pri.includes(l.priority)) return false;
      return true;
    });
  }, [leads, boardFilter]);

  const groups = React.useMemo(() => groupByStage(filteredLeads), [filteredLeads]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const activeLead = activeId ? leads.find((l) => l.id === activeId) : null;

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const activeLead = leads.find((l) => l.id === active.id);
    if (!activeLead) return;

    const overIdStr = String(over.id);
    let destStage: PipelineStage | undefined;
    let destIndex: number | null = null;

    if ((KANBAN_STAGES as string[]).includes(overIdStr)) {
      destStage = overIdStr as PipelineStage;
    } else {
      const overLead = leads.find((l) => l.id === overIdStr);
      if (!overLead) return;
      destStage = overLead.stage;
      destIndex = groups[destStage].findIndex((l) => l.id === overLead.id);
    }

    if (!destStage) return;

    if (destStage === "won") {
      const v = activeLead.estimatedValue;
      if (v == null || v <= 0) {
        toast.error("Won requires a positive estimated value. Open the lead and set deal value first.");
        return;
      }
    }

    setLeads((prev) => {
      const next = [...prev];
      const idx = next.findIndex((l) => l.id === activeLead.id);
      if (idx < 0) return prev;
      if (activeLead.stage === destStage && destIndex != null) {
        const sourceIndex = groups[destStage].findIndex((l) => l.id === activeLead.id);
        if (sourceIndex === destIndex) return prev;
      }
      next[idx] = { ...activeLead, stage: destStage };
      return next;
    });

    if (activeLead.stage !== destStage) {
      updateLeadStage(activeLead.id, destStage, activeLead.stage, currentUserId);
      toast.success(
        `Moved ${activeLead.contactName} · ${STAGES_BY_KEY[activeLead.stage].label} → ${STAGES_BY_KEY[destStage].label}`,
      );
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pipelineCollisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto scrollbar-thin pb-4 -mx-6 px-6">
        {KANBAN_STAGES.map((stageKey) => {
          const stage = STAGES_BY_KEY[stageKey];
          const stageLeads = groups[stageKey];
          const totalValue = stageLeads.reduce(
            (s, l) => s + (l.estimatedValue ?? 0),
            0,
          );
          return (
            <KanbanColumn
              key={stageKey}
              stage={stageKey}
              label={stage.label}
              count={stageLeads.length}
              totalValue={totalValue}
              leads={stageLeads}
              onAddToStage={onAddToStage}
            />
          );
        })}
      </div>

      <DragOverlay>
        {activeLead ? (
          <Card className="w-[300px] cursor-grabbing shadow-2xl ring-1 ring-primary/30">
            <CardContent className="p-3 space-y-2">
              <LeadCardBody lead={activeLead} />
            </CardContent>
          </Card>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({
  stage,
  label,
  count,
  totalValue,
  leads,
  onAddToStage,
}: {
  stage: PipelineStage;
  label: string;
  count: number;
  totalValue: number;
  leads: Lead[];
  onAddToStage?: (stage: PipelineStage) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage,
    data: { type: "column", stage },
  });
  const stageMeta = PIPELINE_STAGES.find((s) => s.key === stage);
  const tone: Record<string, string> = {
    neutral: "bg-muted-foreground/70",
    blue: "bg-info",
    cyan: "bg-cyan-600 dark:bg-cyan-400",
    green: "bg-success",
    red: "bg-destructive",
    amber: "bg-warning",
  };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "w-[300px] shrink-0 flex flex-col rounded-lg border bg-card/40 transition-colors",
        isOver && "ring-2 ring-primary/40 bg-card/80",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2.5 border-b">
        <span className={cn("h-2 w-2 rounded-full", tone[stageMeta?.tone ?? "neutral"])} />
        <span className="text-sm font-semibold">{label}</span>
        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
          {count}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {fmtCurrency(totalValue)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Add lead to ${label}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onAddToStage?.(stage);
          }}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      <SortableContext items={leads.map((l) => l.id)} strategy={verticalListSortingStrategy}>
        <div className="flex-1 p-2 space-y-2 min-h-[200px] max-h-[calc(100vh-240px)] overflow-y-auto scrollbar-thin">
          {leads.map((l) => (
            <LeadCard key={l.id} lead={l} />
          ))}
          {leads.length === 0 && (
            <div className="text-center text-xs text-muted-foreground py-8 border border-dashed rounded-md">
              Drop leads here
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

function LeadCardBody({ lead }: { lead: Lead }) {
  return (
    <>
      <div className="text-sm font-medium leading-tight line-clamp-1">{lead.contactName}</div>
      <div className="text-xs text-muted-foreground line-clamp-1">
        {lead.companyName} · {lead.companyIndustry}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <ChannelChip channel={lead.channel} />
        <Badge
          className={cn(
            "rounded-md text-[10px] border-transparent",
            PRIORITY_TONE[lead.priority].className,
          )}
        >
          {PRIORITY_TONE[lead.priority].label}
        </Badge>
        {lead.isIdle && (
          <Badge
            variant="outline"
            className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] gap-1"
          >
            <AlertTriangle className="h-2.5 w-2.5" />
            {lead.idleDays}d
          </Badge>
        )}
      </div>
      <div className="flex items-center justify-between pt-1">
        <UserChip userId={lead.ownerId} size="xs" nameOnly />
        {lead.estimatedValue != null && (
          <span className="text-xs font-semibold tabular-nums">{fmtCurrency(lead.estimatedValue)}</span>
        )}
      </div>
      {lead.expectedCloseDate && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Calendar className="h-2.5 w-2.5" />
          Close {fmtRelative(lead.expectedCloseDate)}
        </div>
      )}
    </>
  );
}

function LeadCard({ lead }: { lead: Lead }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
    data: { type: "lead", lead },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "touch-manipulation",
        isDragging && "opacity-40",
      )}
      {...attributes}
      {...listeners}
    >
      <Card
        className={cn(
          "relative cursor-grab transition-shadow active:cursor-grabbing",
          isDragging && "shadow-md",
        )}
      >
        <CardContent className="p-0">
          <Link
            href={`/leads/${lead.id}?from=pipeline`}
            className="block space-y-2 p-3 text-left text-foreground no-underline outline-none hover:bg-muted/30 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <LeadCardBody lead={lead} />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
