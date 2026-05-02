"use client";

import * as React from "react";
import type { PipelineStage } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PIPELINE_STAGES } from "@/lib/constants";

export function LeadStageDialog({
  open,
  onOpenChange,
  currentStage,
  contactName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentStage: PipelineStage;
  contactName: string;
  onConfirm: (next: PipelineStage) => void;
}) {
  const [next, setNext] = React.useState<PipelineStage>(currentStage);

  React.useEffect(() => {
    if (open) setNext(currentStage);
  }, [open, currentStage]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" showCloseButton>
        <DialogHeader>
          <DialogTitle>Update stage</DialogTitle>
          <DialogDescription>Change pipeline stage for {contactName}.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Select value={next} onValueChange={(v) => v && setNext(v as PipelineStage)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PIPELINE_STAGES.map((s) => (
                <SelectItem key={s.key} value={s.key}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={next === currentStage}
            onClick={() => {
              onConfirm(next);
              onOpenChange(false);
            }}
          >
            Update stage
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
