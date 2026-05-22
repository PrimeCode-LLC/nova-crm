"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { INSTANTLY_MERGE_VARIABLES } from "@/lib/integrations/instantly/lead-mapper";
import {
  DEFAULT_SEQUENCE_STEP,
  type SequenceStepDraft,
} from "@/lib/integrations/instantly/sequence-utils";

export function SequenceEditor({
  steps,
  onChange,
  disabled,
}: {
  steps: SequenceStepDraft[];
  onChange: (steps: SequenceStepDraft[]) => void;
  disabled?: boolean;
}) {
  function updateStep(i: number, patch: Partial<SequenceStepDraft>) {
    onChange(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  return (
    <div className="space-y-4">
      {steps.map((s, i) => (
        <div key={i} className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Step {i + 1}
              {i > 0 ? ` · wait ${s.delay} day${s.delay === 1 ? "" : "s"} after previous` : " · initial email"}
            </span>
            {steps.length > 1 && !disabled && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => onChange(steps.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          {i > 0 && (
            <div className="grid gap-1.5 max-w-[140px]">
              <Label className="text-xs">Delay (days)</Label>
              <Input
                type="number"
                min={1}
                disabled={disabled}
                value={s.delay}
                onChange={(e) => updateStep(i, { delay: Number(e.target.value) || 1 })}
                className="h-8"
              />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label className="text-xs">Subject</Label>
            <Input
              disabled={disabled}
              value={s.subject}
              onChange={(e) => updateStep(i, { subject: e.target.value })}
              className="h-8"
              placeholder="Quick question about {{company_name}}"
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Body</Label>
            <Textarea
              disabled={disabled}
              value={s.body}
              onChange={(e) => updateStep(i, { body: e.target.value })}
              className="min-h-[100px] text-sm font-mono"
              placeholder="Hi {{first_name}}, …"
            />
          </div>
        </div>
      ))}
      {!disabled && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...steps, { ...DEFAULT_SEQUENCE_STEP }])}
        >
          <Plus className="h-3.5 w-3.5" /> Add follow-up email
        </Button>
      )}
      <p className="text-[11px] text-muted-foreground">
        Use merge tags in subject/body (e.g.{" "}
        {INSTANTLY_MERGE_VARIABLES.slice(0, 4).map((v) => `{{${v.token}}}`).join(", ")}
        …). Add leads on the <strong>Leads</strong> tab so Instantly fills values per contact.
      </p>
    </div>
  );
}
