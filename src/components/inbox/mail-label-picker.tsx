"use client";

import * as React from "react";
import { Tag, PlusCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CreateMailLabelDialog } from "@/components/inbox/mail-labels-sidebar";
import type { MailLabel } from "@/lib/email/mail-labels";
import { cn } from "@/lib/utils";

export function MailLabelPicker({
  labels,
  selectedLabelIds,
  disabled,
  onToggleLabel,
  onRemoveLabel,
  onCreateLabel,
  filterLabel,
  buttonLabel = "Label",
  size = "sm",
  className,
}: {
  labels: MailLabel[];
  selectedLabelIds: string[];
  disabled?: boolean;
  onToggleLabel: (labelId: string) => void;
  /** Explicit remove (unchecking a label also calls onToggleLabel). */
  onRemoveLabel?: (labelId: string) => void;
  onCreateLabel: (name: string, color: string) => void;
  /** When viewing a label filter, show a quick “remove from this label” action. */
  filterLabel?: MailLabel | null;
  buttonLabel?: string;
  size?: "sm" | "default";
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const sorted = React.useMemo(
    () => [...labels].sort((a, b) => a.name.localeCompare(b.name)),
    [labels],
  );
  const selected = React.useMemo(() => new Set(selectedLabelIds), [selectedLabelIds]);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size={size}
              className={cn("gap-1.5", className)}
              disabled={disabled}
            />
          }
        >
          <Tag className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {buttonLabel}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-2">
          {filterLabel && selectedLabelIds.includes(filterLabel.id) ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mb-1 h-8 w-full justify-start gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={disabled}
              onClick={() => {
                (onRemoveLabel ?? onToggleLabel)(filterLabel.id);
                setOpen(false);
              }}
            >
              <X className="h-3.5 w-3.5 shrink-0" />
              Remove from “{filterLabel.name}”
            </Button>
          ) : null}
          {selectedLabelIds.length > 0 ? (
            <div className="mb-2 space-y-0.5 border-b border-border/60 pb-2">
              <p className="px-1 text-[10px] font-medium text-muted-foreground">On this mail</p>
              {selectedLabelIds.map((id) => {
                const label = labels.find((l) => l.id === id);
                if (!label) return null;
                return (
                  <div
                    key={id}
                    className="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-muted/60"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: label.color }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-xs">{label.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={disabled}
                      aria-label={`Remove label ${label.name}`}
                      onClick={() => (onRemoveLabel ?? onToggleLabel)(id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : null}
          {sorted.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">No labels yet.</p>
          ) : (
            <>
              <p className="px-1 pb-1 text-[10px] font-medium text-muted-foreground">Add label</p>
              <ul className="max-h-52 space-y-0.5 overflow-y-auto">
                {sorted.map((label) => (
                  <li key={label.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/60">
                      <Checkbox
                        checked={selected.has(label.id)}
                        onCheckedChange={() => onToggleLabel(label.id)}
                      />
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: label.color }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate">{label.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1 w-full justify-start gap-1.5 text-xs"
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              setCreateOpen(true);
            }}
          >
            <PlusCircle className="h-3.5 w-3.5" />
            Create new label
          </Button>
        </PopoverContent>
      </Popover>
      <CreateMailLabelDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={(name, color) => {
          onCreateLabel(name, color);
          setCreateOpen(false);
        }}
        existingCount={labels.length}
      />
    </>
  );
}
