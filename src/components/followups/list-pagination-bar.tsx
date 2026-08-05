"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  FOLLOWUP_PAGE_SIZE_OPTIONS,
  pageNumbersWithEllipsis,
  type FollowupPageSize,
} from "@/lib/followup-queue-pagination";
import { cn } from "@/lib/utils";

export function ListPaginationBar({
  total,
  pageIndex,
  pageSize,
  onPageIndexChange,
  onPageSizeChange,
  itemLabel,
}: {
  total: number;
  pageIndex: number;
  pageSize: FollowupPageSize;
  onPageIndexChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: FollowupPageSize) => void;
  itemLabel: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const start = total === 0 ? 0 : safePageIndex * pageSize + 1;
  const end = Math.min((safePageIndex + 1) * pageSize, total);
  const pages = pageNumbersWithEllipsis(safePageIndex + 1, totalPages);

  return (
    <div className="mt-3 space-y-3 rounded-md border bg-muted/40 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {total === 0 ? (
            `No ${itemLabel}`
          ) : (
            <>
              Showing{" "}
              <span className="font-medium tabular-nums text-foreground">
                {start}–{end}
              </span>{" "}
              of <span className="tabular-nums text-foreground">{total}</span> {itemLabel}
              <span className="mx-1.5 text-border">·</span>
              Page{" "}
              <span className="font-medium tabular-nums text-foreground">
                {safePageIndex + 1}
              </span>{" "}
              of <span className="tabular-nums text-foreground">{totalPages}</span>
            </>
          )}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="whitespace-nowrap">Per page</span>
          <div className="inline-flex rounded-md border bg-background p-0.5">
            {FOLLOWUP_PAGE_SIZE_OPTIONS.map((n) => (
              <Button
                key={n}
                type="button"
                variant={n === pageSize ? "secondary" : "ghost"}
                size="sm"
                className={cn("h-7 min-w-8 px-2 tabular-nums", n === pageSize && "shadow-sm")}
                aria-pressed={n === pageSize}
                aria-label={`${n} per page`}
                onClick={() => onPageSizeChange(n)}
              >
                {n}
              </Button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          disabled={safePageIndex <= 0 || total === 0}
          onClick={() => onPageIndexChange(safePageIndex - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Previous
        </Button>
        {pages.map((page, index) =>
          page === "ellipsis" ? (
            <span key={`ellipsis-${index}`} className="px-1 tabular-nums text-muted-foreground">
              …
            </span>
          ) : (
            <Button
              key={page}
              type="button"
              variant={page === safePageIndex + 1 ? "default" : "outline"}
              size="sm"
              className="h-8 min-w-8 px-2 tabular-nums"
              aria-label={`Page ${page}`}
              aria-current={page === safePageIndex + 1 ? "page" : undefined}
              onClick={() => onPageIndexChange(page - 1)}
            >
              {page}
            </Button>
          ),
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          disabled={safePageIndex >= totalPages - 1 || total === 0}
          onClick={() => onPageIndexChange(safePageIndex + 1)}
          aria-label="Next page"
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
