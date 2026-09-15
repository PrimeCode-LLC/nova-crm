"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  MailWarning,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { UserChip } from "@/components/common/user-chip";
import { ListPaginationBar } from "@/components/followups/list-pagination-bar";
import { PRIORITY_TONE } from "@/lib/constants";
import {
  followupSendState,
  formatFollowupDueLabel,
  formatFollowupQueuedLabel,
  isFollowupRetryable,
  type FollowupDueBucket,
} from "@/lib/followup-due-display";
import type { FollowupPageSize } from "@/lib/followup-queue-pagination";
import type { Followup, Lead } from "@/lib/types";
import { cn } from "@/lib/utils";

export function FollowupGroup({
  title,
  description,
  tone,
  bucket,
  items,
  empty,
  pageSize,
  onPageSizeChange,
  getLeadById,
  onToggleComplete,
  onRowNavigate,
  canMutate,
  onRequestDelete,
  onRequestEdit,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  timeZone,
  isViewToday,
  onRequestTryNow,
  onRequestReschedule,
  busy,
}: {
  title: string;
  description: string;
  tone: "rose" | "amber" | "neutral";
  bucket: FollowupDueBucket;
  items: Followup[];
  empty: string;
  pageSize: FollowupPageSize;
  onPageSizeChange: (pageSize: FollowupPageSize) => void;
  getLeadById: (id: string) => Lead | undefined;
  onToggleComplete: (id: string, completed: boolean) => void;
  onRowNavigate: (leadId: string) => void;
  canMutate: (f: Followup) => boolean;
  onRequestDelete: (f: Followup) => void;
  onRequestEdit: (f: Followup) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string, selected: boolean) => void;
  onToggleSelectAll: (ids: string[], selected: boolean) => void;
  timeZone: string;
  isViewToday: boolean;
  onRequestTryNow: (f: Followup) => void;
  onRequestReschedule: (f: Followup) => void;
  busy: boolean;
}) {
  const [pageIndex, setPageIndex] = React.useState(0);
  const toneRing =
    tone === "rose"
      ? "border-destructive/30 bg-destructive/5"
      : tone === "amber"
        ? "border-warning/30 bg-warning/5"
        : "";

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const pageStart = safePageIndex * pageSize;
  const pageItems = items.slice(pageStart, pageStart + pageSize);
  const groupIds = React.useMemo(() => items.map((f) => f.id), [items]);
  const pageIds = pageItems.map((f) => f.id);

  React.useEffect(() => {
    setPageIndex(0);
  }, [pageSize]);

  React.useEffect(() => {
    setPageIndex((prev) => Math.min(prev, Math.max(0, totalPages - 1)));
  }, [totalPages]);

  const selectedOnPage = pageIds.filter((id) => selectedIds.has(id)).length;
  const allPageSelected = pageIds.length > 0 && selectedOnPage === pageIds.length;
  const somePageSelected = selectedOnPage > 0 && !allPageSelected;
  const selectedInGroup = groupIds.filter((id) => selectedIds.has(id)).length;
  const allGroupSelected = groupIds.length > 0 && selectedInGroup === groupIds.length;
  const canSelectAllInGroup = allPageSelected && items.length > pageSize && !allGroupSelected;

  return (
    <Card className={cn(toneRing)}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            {items.length > 0 ? (
              <Checkbox
                className="mt-0.5"
                checked={allPageSelected || allGroupSelected}
                indeterminate={somePageSelected || (selectedInGroup > 0 && !allPageSelected && !allGroupSelected)}
                onCheckedChange={(v) => {
                  if (v === true) {
                    onToggleSelectAll(pageIds, true);
                    return;
                  }
                  if (allGroupSelected) {
                    onToggleSelectAll(groupIds, false);
                    return;
                  }
                  onToggleSelectAll(pageIds, false);
                }}
                aria-label={`Select page in ${title}`}
              />
            ) : null}
            <div className="min-w-0">
              <CardTitle className="text-sm">
                {title}
                <Badge variant="secondary" className="ml-2 h-4 px-1 text-[10px]">
                  {items.length}
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs">{description}</CardDescription>
              {canSelectAllInGroup ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto px-0 text-xs"
                  onClick={() => onToggleSelectAll(groupIds, true)}
                >
                  Select all {items.length} in {title}
                </Button>
              ) : null}
              {allGroupSelected && items.length > pageSize ? (
                <p className="text-xs text-muted-foreground">All {items.length} in {title} selected</p>
              ) : null}
            </div>
          </div>
          {items.length > 0 ? (
            <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={safePageIndex <= 0}
                aria-label={`Previous ${title} page`}
                onClick={() => setPageIndex(safePageIndex - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="min-w-[4.5rem] text-center tabular-nums">
                {safePageIndex + 1} / {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={safePageIndex >= totalPages - 1}
                aria-label={`Next ${title} page`}
                onClick={() => setPageIndex(safePageIndex + 1)}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">{empty}</p>
        ) : (
          <>
            <ul className="divide-y">
              {pageItems.map((f) => (
                <li key={f.id}>
                  <FollowupRow
                    f={f}
                    bucket={bucket}
                    lead={f.leadId ? getLeadById(f.leadId) : undefined}
                    selected={selectedIds.has(f.id)}
                    mutate={canMutate(f)}
                    timeZone={timeZone}
                    isViewToday={isViewToday}
                    busy={busy}
                    onToggleComplete={onToggleComplete}
                    onRowNavigate={onRowNavigate}
                    onToggleSelect={onToggleSelect}
                    onRequestDelete={onRequestDelete}
                    onRequestEdit={onRequestEdit}
                    onRequestTryNow={onRequestTryNow}
                    onRequestReschedule={onRequestReschedule}
                  />
                </li>
              ))}
            </ul>
            <ListPaginationBar
              total={items.length}
              pageIndex={safePageIndex}
              pageSize={pageSize}
              onPageIndexChange={setPageIndex}
              onPageSizeChange={onPageSizeChange}
              itemLabel={items.length === 1 ? "followup" : "followups"}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

const FollowupRow = React.memo(function FollowupRow({
  f,
  bucket,
  lead,
  selected,
  mutate,
  timeZone,
  isViewToday,
  busy,
  onToggleComplete,
  onRowNavigate,
  onToggleSelect,
  onRequestDelete,
  onRequestEdit,
  onRequestTryNow,
  onRequestReschedule,
}: {
  f: Followup;
  bucket: FollowupDueBucket;
  lead: Lead | undefined;
  selected: boolean;
  mutate: boolean;
  timeZone: string;
  isViewToday: boolean;
  busy: boolean;
  onToggleComplete: (id: string, completed: boolean) => void;
  onRowNavigate: (leadId: string) => void;
  onToggleSelect: (id: string, selected: boolean) => void;
  onRequestDelete: (f: Followup) => void;
  onRequestEdit: (f: Followup) => void;
  onRequestTryNow: (f: Followup) => void;
  onRequestReschedule: (f: Followup) => void;
}) {
  const done = Boolean(f.completedAt);
  const sendState = followupSendState(f);
  const queued = sendState === "queued" || sendState === "queued_late";
  // Try now on a queued row cancels the queued email and re-queues it, which
  // sends it to the back of the per-mailbox send gap. Only offer it when there
  // is nothing in flight, or when the send actually needs a retry.
  const showTryNow =
    mutate &&
    !done &&
    (isFollowupRetryable(f) ||
      (!queued && (bucket === "overdue" || bucket === "today" || bucket === "failed")));
  const isFailed = sendState === "failed";
  const isRetrying = sendState === "retrying";
  const due = queued
    ? {
        label: formatFollowupQueuedLabel(
          f.emailScheduledAt,
          sendState as "queued" | "queued_late",
          timeZone,
        ),
        soon: sendState === "queued",
      }
    : formatFollowupDueLabel(f.dueAt, bucket, timeZone, { isViewToday });

  return (
    <div
      className={cn(
        "flex h-full items-center gap-3 py-2.5 -mx-1 px-1 rounded-md transition-colors",
        lead && "cursor-pointer hover:bg-muted/40",
        selected && "bg-muted/50",
      )}
      role={lead ? "button" : undefined}
      tabIndex={lead ? 0 : undefined}
      onClick={(e) => {
        if (
          (e.target as HTMLElement).closest(
            "[data-slot=checkbox], a, [data-followup-delete], [data-followup-edit], [data-followup-trynow], [data-followup-reschedule]",
          )
        )
          return;
        if (f.leadId) onRowNavigate(f.leadId);
      }}
      onKeyDown={(e) => {
        if (!f.leadId) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onRowNavigate(f.leadId);
        }
      }}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={(v) => onToggleSelect(f.id, v === true)}
        aria-label={`Select ${f.title}`}
      />
      <Checkbox
        checked={done}
        onCheckedChange={(v) => onToggleComplete(f.id, v === true)}
        aria-label={done ? `Mark ${f.title} incomplete` : `Mark ${f.title} complete`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{f.title}</span>
          <Badge
            className={cn(
              "rounded-md border-transparent text-[10px]",
              PRIORITY_TONE[f.priority].className,
            )}
          >
            {PRIORITY_TONE[f.priority].label}
          </Badge>
          {isFailed ? (
            <Badge
              variant="outline"
              className="text-[10px] gap-1 border-destructive/50 text-destructive"
            >
              <MailWarning className="h-2.5 w-2.5" />
              Send failed
            </Badge>
          ) : null}
          {isRetrying ? (
            <Badge
              variant="outline"
              className="text-[10px] gap-1 border-amber-500/50 text-amber-700 dark:text-amber-400"
            >
              <RefreshCw className="h-2.5 w-2.5" />
              Retrying
            </Badge>
          ) : null}
          {queued ? (
            <Badge variant="outline" className="text-[10px] gap-1">
              <Clock className="h-2.5 w-2.5" />
              Queued
            </Badge>
          ) : null}
          {f.auto && (
            <Badge variant="outline" className="text-[10px] gap-1">
              <Sparkles className="h-2.5 w-2.5" /> Auto
            </Badge>
          )}
        </div>
        {lead && (
          <Link
            href={`/leads/${lead.id}`}
            className="text-xs text-muted-foreground hover:text-primary truncate block mt-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            {lead.contactName} · {lead.companyName}
          </Link>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <UserChip userId={f.ownerId} size="xs" nameOnly />
        <span
          className={cn(
            "text-xs tabular-nums whitespace-nowrap",
            queued
              ? "text-muted-foreground"
              : bucket === "overdue" || bucket === "failed"
                ? "text-destructive"
                : due.soon
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground",
          )}
        >
          {due.label}
        </span>
        {showTryNow ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            data-followup-trynow
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              onRequestTryNow(f);
            }}
          >
            <RefreshCw className="h-3 w-3" />
            Try now
          </Button>
        ) : null}
        {mutate ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              data-followup-reschedule
              aria-label="Reschedule followup"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                onRequestReschedule(f);
              }}
            >
              <CalendarClock className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              data-followup-edit
              aria-label="Edit followup"
              onClick={(e) => {
                e.stopPropagation();
                onRequestEdit(f);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              data-followup-delete
              aria-label="Delete followup"
              onClick={(e) => {
                e.stopPropagation();
                onRequestDelete(f);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
});
