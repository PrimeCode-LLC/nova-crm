"use client";

import { Button } from "@/components/ui/button";

export function CrmListLoadMore({
  hasMore,
  onLoadMore,
}: {
  hasMore: boolean;
  onLoadMore: () => void;
}) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center py-3">
      <Button type="button" variant="outline" size="sm" onClick={onLoadMore}>
        Load more
      </Button>
    </div>
  );
}
