"use client";

import * as React from "react";
import { toast } from "sonner";
import type { ChannelKey, Lead, Touchpoint } from "@/lib/types";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useChannelOptions } from "@/hooks/use-channel-options";
import { channelLabelFromValue } from "@/lib/channel-options";

function newId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

export function LogTouchpointDialog({
  open,
  onOpenChange,
  lead,
  currentUserId,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  currentUserId: string;
  onCreate: (t: Touchpoint) => void;
}) {
  const channelOptions = useChannelOptions();
  const allChannelOptions = useChannelOptions({ includeDisabled: true });
  const [channel, setChannel] = React.useState<ChannelKey>("cold_email");
  const [state, setState] = React.useState("");
  const [summary, setSummary] = React.useState("");

  React.useEffect(() => {
    if (!open || !lead) return;
    React.startTransition(() => {
      setChannel(lead.channel);
      setState("");
      setSummary("");
    });
  }, [open, lead]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lead) return;
    const st = state.trim();
    if (!st) {
      toast.error("Enter a state / step key (e.g. email_step_2).");
      return;
    }
    const t: Touchpoint = {
      id: newId("tp-local"),
      leadId: lead.id,
      channel,
      state: st,
      occurredAt: new Date().toISOString(),
      actorId: currentUserId,
      summary: summary.trim() || undefined,
    };
    onCreate(t);
    toast.success("Touchpoint logged");
    onOpenChange(false);
  }

  if (!lead) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add touchpoint</DialogTitle>
            <DialogDescription>
              Record engagement on a channel for {lead.contactName}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label>Channel</Label>
              <Select value={channel} onValueChange={(v) => v && setChannel(v as ChannelKey)}>
                <SelectTrigger>
                  <SelectValue>
                    {channelLabelFromValue(channel, allChannelOptions) || channel}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(channel && !channelOptions.some((c) => c.key === channel)
                    ? [
                        {
                          key: channel,
                          label: channelLabelFromValue(channel, allChannelOptions) || channel,
                        },
                        ...channelOptions,
                      ]
                    : channelOptions
                  ).map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tp-state">State / step</Label>
              <Input
                id="tp-state"
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="e.g. email_step_2, connection_sent"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tp-sum">Summary (optional)</Label>
              <Input
                id="tp-sum"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Short description"
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save touchpoint</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
