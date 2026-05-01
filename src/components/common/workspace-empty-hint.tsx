"use client";

import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";

export function WorkspaceEmptyHint({
  title = "No data in workspace yet",
  description = "Switch to Demo to explore the product with a full sample pipeline, or connect your data sources when they are available.",
}: {
  title?: string;
  description?: string;
}) {
  const { setMode } = useWorkspace();

  return (
    <div className="rounded-lg border border-dashed bg-muted/20 px-6 py-10 text-center space-y-3 max-w-md mx-auto">
      <div className="flex justify-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10 text-amber-400">
          <FlaskConical className="h-5 w-5" />
        </div>
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{description}</p>
      </div>
      <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => void setMode("demo")}>
        <FlaskConical className="h-3.5 w-3.5" />
        Open demo data
      </Button>
    </div>
  );
}
