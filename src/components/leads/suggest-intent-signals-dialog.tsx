"use client";

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { Lead } from "@/lib/types";
import { cn } from "@/lib/utils";

export type IntentSignalSuggestion = {
  field: "hiringSignals" | "triggerEvent" | "painPoints" | "recentNews" | "businessFocus";
  value: string;
  signalLabel: string;
  rationale?: string;
  signalId?: string;
};

const FIELD_LABELS: Record<IntentSignalSuggestion["field"], string> = {
  hiringSignals: "Hiring signals",
  triggerEvent: "Trigger event",
  painPoints: "Pain points",
  recentNews: "Recent news",
  businessFocus: "Business focus",
};

type ApplyMode = "fill_empty" | "append";

type Row = IntentSignalSuggestion & {
  key: string;
  included: boolean;
};

function currentFieldValue(lead: Lead, field: IntentSignalSuggestion["field"]): string {
  const v = lead[field];
  return typeof v === "string" ? v.trim() : "";
}

function mergeValue(existing: string, next: string, mode: ApplyMode): string | null {
  const trimmed = next.trim();
  if (!trimmed) return null;
  if (!existing) return trimmed;
  if (mode === "fill_empty") return null;
  if (existing.toLowerCase().includes(trimmed.toLowerCase())) return null;
  return `${existing}\n\n${trimmed}`;
}

export function SuggestIntentSignalsDialog({
  open,
  onOpenChange,
  lead,
  loading,
  suggestions,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead;
  loading: boolean;
  suggestions: IntentSignalSuggestion[];
  onApply: (patch: Partial<Lead>) => void;
}) {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [mode, setMode] = React.useState<ApplyMode>("append");

  React.useEffect(() => {
    if (!open) return;
    setRows(
      suggestions.map((s, i) => ({
        ...s,
        key: `${s.field}-${s.signalLabel}-${i}`,
        included: true,
      })),
    );
    setMode("append");
  }, [open, suggestions]);

  const selected = rows.filter((r) => r.included);

  const previewPatch = React.useMemo(() => {
    const patch: Partial<Lead> = {};
    const byField = new Map<IntentSignalSuggestion["field"], string[]>();
    for (const row of selected) {
      const list = byField.get(row.field) ?? [];
      list.push(row.value.trim());
      byField.set(row.field, list);
    }
    for (const [field, values] of byField) {
      const existing = currentFieldValue(lead, field);
      const cleaned = values.filter(Boolean);
      if (!cleaned.length) continue;
      if (mode === "fill_empty") {
        if (existing) continue;
        patch[field] = cleaned.join("\n\n");
        continue;
      }
      let next = existing;
      for (const value of cleaned) {
        const merged = mergeValue(next, value, "append");
        if (merged != null) next = merged;
      }
      if (next && next !== existing) {
        patch[field] = next;
      }
    }
    return patch;
  }, [lead, mode, selected]);

  const applyCount = Object.keys(previewPatch).length;

  const toggle = (key: string, included: boolean) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, included } : r)));
  };

  const handleApply = () => {
    if (!applyCount) {
      toast.message("Nothing to apply", {
        description:
          mode === "fill_empty"
            ? "Selected fields already have content. Switch to Append, or clear a field first."
            : "Selected suggestions are already present in the research fields.",
      });
      return;
    }
    onApply(previewPatch);
    onOpenChange(false);
    toast.success(
      `Applied ${applyCount} research field${applyCount === 1 ? "" : "s"}`,
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[min(85vh,720px)] grid-rows-[auto_1fr_auto] overflow-hidden p-0 gap-0">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Signal suggestions
          </DialogTitle>
          <DialogDescription>
            Review AI suggestions grounded in this lead’s research. Choose what to write into
            research fields — scoring updates automatically after apply.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Finding playbook matches…
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No new signal suggestions. Research may already cover the playbook, or there is
              little grounded evidence to add.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "append" ? "secondary" : "ghost"}
                  onClick={() => setMode("append")}
                >
                  Append to fields
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "fill_empty" ? "secondary" : "ghost"}
                  onClick={() => setMode("fill_empty")}
                >
                  Fill empty only
                </Button>
              </div>

              <ul className="space-y-3">
                {rows.map((row) => {
                  const existing = currentFieldValue(lead, row.field);
                  const willWrite =
                    row.included &&
                    mergeValue(existing, row.value, mode) != null;
                  return (
                    <li
                      key={row.key}
                      className={cn(
                        "rounded-lg border p-3 space-y-2 transition-colors",
                        row.included ? "bg-muted/30" : "opacity-60",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox
                          id={row.key}
                          checked={row.included}
                          onCheckedChange={(v) => toggle(row.key, v === true)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Label htmlFor={row.key} className="font-medium cursor-pointer">
                              {row.signalLabel}
                            </Label>
                            <Badge variant="outline" className="rounded-md font-normal text-xs">
                              {FIELD_LABELS[row.field]}
                            </Badge>
                            {existing ? (
                              <Badge
                                variant="secondary"
                                className="rounded-md font-normal text-xs"
                              >
                                {willWrite ? "Will append" : "Already covered"}
                              </Badge>
                            ) : (
                              <Badge
                                variant="secondary"
                                className="rounded-md font-normal text-xs"
                              >
                                Empty field
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-foreground leading-relaxed">{row.value}</p>
                          {row.rationale ? (
                            <p className="text-xs text-muted-foreground">{row.rationale}</p>
                          ) : null}
                          {existing && row.included ? (
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              Current: {existing}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={loading || !selected.length}
            onClick={handleApply}
          >
            Apply {applyCount ? `${applyCount} field${applyCount === 1 ? "" : "s"}` : "selected"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
