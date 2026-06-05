"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";

export function CampaignWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { addCampaign, isDemo } = useWorkspace();
  const [submitting, setSubmitting] = React.useState(false);
  const [name, setName] = React.useState("");
  const [connectionLoaded, setConnectionLoaded] = React.useState(false);
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (isDemo) {
      setConnectionLoaded(true);
      setConnected(false);
      return;
    }
    setConnectionLoaded(false);
    void (async () => {
      try {
        const res = await fetch("/api/integrations/instantly/connection");
        if (!res.ok) {
          setConnected(false);
          return;
        }
        const data = (await res.json()) as { connected?: boolean };
        setConnected(Boolean(data.connected));
      } catch {
        setConnected(false);
      } finally {
        setConnectionLoaded(true);
      }
    })();
  }, [open, isDemo]);

  function reset() {
    setName("");
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Enter a campaign name");
      return;
    }

    setSubmitting(true);
    try {
      if (isDemo) {
        const id = `c-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
        addCampaign({
          id,
          name: trimmed,
          channel: "cold_email",
          status: "draft",
          externalRef: `instantly:demo-${id.slice(2, 10)}`,
          instantlyId: `demo-${id.slice(2, 10)}`,
          startedAt: new Date().toISOString(),
          stats: { sent: 0, replied: 0, meetings: 0, closed: 0 },
        });
        toast.success("Campaign created (demo)");
        onOpenChange(false);
        reset();
        router.push(`/outreach/${id}?tab=sequence`);
        return;
      }

      if (!connectionLoaded) {
        toast.error("Still checking Instantly connection, try again in a moment");
        return;
      }
      if (!connected) {
        toast.error("Connect Instantly in Settings → Integrations before creating campaigns");
        return;
      }

      const res = await fetch("/api/integrations/instantly/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Could not create campaign");
        return;
      }
      const campaign = data.campaign as { id: string };
      toast.success("Campaign created in Instantly");
      onOpenChange(false);
      reset();
      router.push(`/outreach/${campaign.id}?tab=sequence`);
    } finally {
      setSubmitting(false);
    }
  }

  const createDisabled =
    submitting || (!isDemo && connectionLoaded && !connected);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>New outreach campaign</DialogTitle>
          <DialogDescription>
            {isDemo
              ? "Demo workspace, campaign is saved locally only."
              : "Name your campaign now. Build the sequence, accounts, and options on the campaign page after it is created."}
          </DialogDescription>
        </DialogHeader>

        {!isDemo && connectionLoaded && !connected && (
          <p className="text-xs text-warning">
            Instantly is not connected.{" "}
            <Link href="/settings?tab=integrations" className="underline underline-offset-2">
              Connect in Settings
            </Link>{" "}
            to create live campaigns.
          </p>
        )}

        <div className="grid gap-2 py-1">
          <Label htmlFor="cw-name">Campaign name</Label>
          <Input
            id="cw-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="Q2 enterprise outbound"
            disabled={createDisabled}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !createDisabled) void submit();
            }}
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={createDisabled || (!isDemo && !connectionLoaded)} onClick={() => void submit()}>
            {submitting || (!isDemo && !connectionLoaded) ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            Create campaign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
