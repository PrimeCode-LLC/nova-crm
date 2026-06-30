"use client";

import * as React from "react";
import { Plus, Tag, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CRM_LABEL_COLOR_PRESETS } from "@/lib/crm-label-colors";
import type { MailLabel } from "@/lib/email/mail-labels";
import { cn } from "@/lib/utils";

export function CreateMailLabelDialog({
  open,
  onOpenChange,
  onCreate,
  existingCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, color: string) => void;
  existingCount: number;
}) {
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState(CRM_LABEL_COLOR_PRESETS[existingCount % CRM_LABEL_COLOR_PRESETS.length]!);

  React.useEffect(() => {
    if (open) {
      setName("");
      setColor(CRM_LABEL_COLOR_PRESETS[existingCount % CRM_LABEL_COLOR_PRESETS.length]!);
    }
  }, [open, existingCount]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed, color);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Create label</DialogTitle>
            <DialogDescription>
              Labels work like Gmail: messages stay in Inbox and can have multiple labels.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="mail-label-name">Name</Label>
              <Input
                id="mail-label-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Follow up"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {CRM_LABEL_COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={cn(
                      "h-6 w-6 rounded-full border-2 transition-transform hover:scale-110",
                      color === c ? "border-foreground scale-110" : "border-transparent",
                    )}
                    style={{ backgroundColor: c }}
                    aria-label="Select label color"
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MailLabelsSidebarSection({
  labels,
  selectedLabelId,
  labelCounts,
  disabled,
  onSelectLabel,
  onClearLabel,
  onCreateLabel,
  onDeleteLabel,
}: {
  labels: MailLabel[];
  selectedLabelId: string | null;
  labelCounts: Record<string, number>;
  disabled?: boolean;
  onSelectLabel: (labelId: string) => void;
  onClearLabel: () => void;
  onCreateLabel: (name: string, color: string) => void;
  onDeleteLabel: (labelId: string) => void;
}) {
  const [createOpen, setCreateOpen] = React.useState(false);
  const sorted = React.useMemo(
    () => [...labels].sort((a, b) => a.name.localeCompare(b.name)),
    [labels],
  );

  return (
    <>
      <div className="space-y-1 pt-2 border-t border-border/60">
        <div className="flex items-center justify-between gap-1 px-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Labels</p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-6 w-6 shrink-0"
            disabled={disabled}
            aria-label="Create label"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        {sorted.length === 0 ? (
          <p className="px-1 text-[10px] text-muted-foreground leading-snug">
            No labels yet.{" "}
            <button
              type="button"
              className="text-primary underline-offset-2 hover:underline disabled:opacity-50"
              disabled={disabled}
              onClick={() => setCreateOpen(true)}
            >
              Create one
            </button>
          </p>
        ) : (
          sorted.map((label) => {
            const count = labelCounts[label.id] ?? 0;
            const active = selectedLabelId === label.id;
            return (
              <div key={label.id} className="group flex items-center gap-0.5">
                <Button
                  variant={active ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 min-w-0 flex-1 justify-start px-2 text-[11px] gap-1.5"
                  onClick={() => (active ? onClearLabel() : onSelectLabel(label.id))}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: label.color }}
                    aria-hidden
                  />
                  <span className="truncate">{label.name}</span>
                  {count > 0 ? (
                    <Badge variant="outline" className="ml-auto h-5 px-1 text-[10px] tabular-nums shrink-0">
                      {count}
                    </Badge>
                  ) : null}
                </Button>
                {!disabled ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label={`Label options for ${label.name}`}
                    >
                      <Tag className="h-3 w-3" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => onDeleteLabel(label.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete label
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            );
          })
        )}
      </div>
      <CreateMailLabelDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={onCreateLabel}
        existingCount={labels.length}
      />
    </>
  );
}

export function MailLabelChips({
  labelIds,
  labels,
  className,
  max = 3,
  onRemoveLabel,
  disabled,
}: {
  labelIds: string[];
  labels: MailLabel[];
  className?: string;
  max?: number;
  onRemoveLabel?: (labelId: string) => void;
  disabled?: boolean;
}) {
  if (labelIds.length === 0) return null;
  const byId = new Map(labels.map((l) => [l.id, l]));
  const visible = labelIds.slice(0, max);
  const extra = labelIds.length - visible.length;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {visible.map((id) => {
        const def = byId.get(id);
        if (!def) return null;
        return (
          <span
            key={id}
            className="group/chip inline-flex max-w-32 items-center gap-0.5 truncate rounded px-1.5 py-0.5 text-[9px] font-medium text-foreground/90"
            style={{ backgroundColor: `${def.color}22`, borderLeft: `2px solid ${def.color}` }}
            title={def.name}
          >
            <span className="truncate">{def.name}</span>
            {onRemoveLabel && !disabled ? (
              <button
                type="button"
                className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm opacity-60 hover:bg-background/80 hover:opacity-100"
                aria-label={`Remove label ${def.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveLabel(id);
                }}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            ) : null}
          </span>
        );
      })}
      {extra > 0 ? (
        <span className="text-[9px] text-muted-foreground tabular-nums">+{extra}</span>
      ) : null}
    </div>
  );
}
