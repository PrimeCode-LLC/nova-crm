"use client";

import * as React from "react";
import Link from "next/link";
import { Tag, PlusCircle } from "lucide-react";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function labelById(
  crmLabels: readonly { id: string; name: string; color?: string }[],
  id: string,
): { id: string; name: string; color?: string } | undefined {
  return crmLabels.find((l) => l.id === id);
}

export function EntityLabelPicker({
  labelIds,
  onChange,
  disabled,
  className,
  /** When true, show a stronger empty state for lead / record detail pages. */
  emphasizeAddAction = false,
}: {
  labelIds: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  className?: string;
  emphasizeAddAction?: boolean;
}) {
  const ws = useWorkspace();
  const sorted = React.useMemo(
    () => [...ws.crmLabels].sort((a, b) => a.name.localeCompare(b.name)),
    [ws.crmLabels],
  );
  const set = React.useMemo(() => new Set(labelIds), [labelIds]);

  const toggle = (id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  const hasWorkspaceLabels = sorted.length > 0;
  const emptyNoDefinitions = labelIds.length === 0 && !hasWorkspaceLabels;
  const emptyButCanAdd = labelIds.length === 0 && hasWorkspaceLabels;

  return (
    <div className={cn("space-y-3", className)}>
      {emphasizeAddAction && emptyButCanAdd ? (
        <div className="rounded-lg border border-dashed border-muted-foreground/25 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">No labels on this lead yet.</span> Use{" "}
          <span className="text-foreground">Add labels</span> below, you can select{" "}
          <span className="text-foreground">multiple</span> tags for one lead.
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1 min-h-[24px] items-center">
        {labelIds.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            {emptyNoDefinitions ? "No labels (create some under Configuration → Labels)" : "No labels selected"}
          </span>
        ) : (
          labelIds.map((id) => {
            const def = labelById(ws.crmLabels, id);
            return (
              <Badge
                key={id}
                variant="outline"
                className="text-[10px] font-normal gap-1 pr-1 border-border/80"
                style={
                  def?.color
                    ? { borderLeftWidth: 3, borderLeftColor: def.color, borderLeftStyle: "solid" as const }
                    : undefined
                }
              >
                {def?.name ?? id}
              </Badge>
            );
          })
        )}
      </div>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant={emphasizeAddAction && labelIds.length === 0 && hasWorkspaceLabels ? "secondary" : "outline"}
              size="sm"
              className={cn(
                "h-9 gap-2",
                emphasizeAddAction && labelIds.length === 0 && hasWorkspaceLabels && "font-medium",
              )}
              disabled={disabled}
            >
              {labelIds.length === 0 ? (
                <PlusCircle className="h-4 w-4 shrink-0 opacity-90" />
              ) : (
                <Tag className="h-3.5 w-3.5 shrink-0" />
              )}
              {labelIds.length === 0 ? "Add labels" : `Edit labels (${labelIds.length})`}
            </Button>
          }
        />
        <PopoverContent className="w-72 p-3" align="start">
          {sorted.length === 0 ? (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">No labels in this workspace yet.</p>
              <Link href="/admin/labels" className="text-xs text-primary underline-offset-4 hover:underline">
                Create labels
              </Link>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              <p className="text-xs text-muted-foreground">
                Select any combination, all checked labels apply to this lead.
              </p>
              {sorted.map((l) => (
                <div key={l.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`lbl-${l.id}`}
                    checked={set.has(l.id)}
                    onCheckedChange={() => toggle(l.id)}
                    disabled={disabled}
                  />
                  <Label htmlFor={`lbl-${l.id}`} className="text-sm font-normal flex-1 cursor-pointer leading-tight">
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle shrink-0"
                      style={{ background: l.color ?? "hsl(var(--muted-foreground))" }}
                    />
                    {l.name}
                  </Label>
                </div>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
