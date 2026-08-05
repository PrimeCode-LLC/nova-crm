"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FOLLOWUP_PAGE_SIZE_OPTIONS,
  pageNumbersWithEllipsis,
  type FollowupPageSize,
} from "@/lib/followup-queue-pagination";

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
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 text-xs text-muted-foreground">
      <span>
        {total === 0 ? (
          `No ${itemLabel}`
        ) : (
          <>
            Showing{" "}
            <span className="font-medium tabular-nums text-foreground">
              {start}–{end}
            </span>{" "}
            of <span className="tabular-nums">{total}</span> {itemLabel}
          </>
        )}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span className="whitespace-nowrap">Rows per page</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              const next = Number(value);
              if (!FOLLOWUP_PAGE_SIZE_OPTIONS.includes(next as FollowupPageSize)) return;
              onPageSizeChange(next as FollowupPageSize);
            }}
          >
            <SelectTrigger size="sm" className="h-8 w-[4.5rem] tabular-nums" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {FOLLOWUP_PAGE_SIZE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1">
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
                variant={page === safePageIndex + 1 ? "secondary" : "outline"}
                size="sm"
                className="h-8 w-8 p-0 tabular-nums"
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
    </div>
  );
}
