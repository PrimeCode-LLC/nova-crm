"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Gate = { id: string; passed: boolean; detail: string };

export function PromoteSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configId: string;
  configLabel: string;
  toZone: "canary" | "default";
  onPromoted: () => void;
}) {
  const { open, onOpenChange, configId, configLabel, toZone, onPromoted } = props;
  const [gates, setGates] = React.useState<Gate[]>([]);
  const [blocked, setBlocked] = React.useState<Gate[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [cancelPending, setCancelPending] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    setCancelPending(false);
    void (async () => {
      try {
        const res = await fetch(`/api/ai/outreach-configs/${configId}/promote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toZone, dryRun: true }),
        });
        const data = await res.json();
        setGates(Array.isArray(data.gates) ? data.gates : []);
        setBlocked(Array.isArray(data.blocked) ? data.blocked : []);
      } catch {
        toast.error("Failed to preview gates");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, configId, toZone]);

  const canPromote = blocked.length === 0;

  async function confirm() {
    if (!canPromote) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/ai/outreach-configs/${configId}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toZone, cancelPending }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGates(Array.isArray(data.gates) ? data.gates : gates);
        setBlocked(Array.isArray(data.blocked) ? data.blocked : []);
        toast.error(typeof data.error === "string" ? data.error : "Promotion blocked");
        return;
      }
      toast.success(`Promoted to ${toZone}`);
      onOpenChange(false);
      onPromoted();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Promote → {toZone}</DialogTitle>
          <DialogDescription>
            Gate checklist for <span className="font-medium text-foreground">{configLabel}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {loading && <p className="text-sm text-muted-foreground">Checking gates…</p>}
          {!loading &&
            gates.map((gate) => (
              <div
                key={gate.id}
                className="flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm"
              >
                <div>
                  <div className="font-medium">{gate.id}</div>
                  <div className="text-xs text-muted-foreground">{gate.detail}</div>
                </div>
                <Badge variant={gate.passed ? "secondary" : "destructive"}>
                  {gate.passed ? "pass" : "fail"}
                </Badge>
              </div>
            ))}
          <div className="flex items-center gap-2 pt-2">
            <Checkbox
              id="cancel-pending"
              checked={cancelPending}
              onCheckedChange={(v) => setCancelPending(v === true)}
            />
            <Label htmlFor="cancel-pending" className="text-sm font-normal">
              Cancel pending outreach for leads on this config
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void confirm()} disabled={busy || loading || !canPromote}>
            {busy ? "Promoting…" : canPromote ? `Promote to ${toZone}` : "Gates blocked"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
