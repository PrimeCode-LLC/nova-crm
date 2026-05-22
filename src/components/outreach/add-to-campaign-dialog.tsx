"use client";

import * as React from "react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { pushLeadsToCampaign } from "@/lib/outreach/push-leads";

export function AddToCampaignDialog({
  open,
  onOpenChange,
  leadIds,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  onSuccess?: () => void;
}) {
  const { campaigns, isDemo, patchLead } = useWorkspace();
  const [campaignId, setCampaignId] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState(false);

  const coldCampaigns = React.useMemo(
    () => campaigns.filter((c) => c.channel === "cold_email" && c.status !== "done"),
    [campaigns],
  );

  React.useEffect(() => {
    if (open && coldCampaigns.length > 0 && !campaignId) {
      setCampaignId(coldCampaigns[0]!.id);
    }
  }, [open, coldCampaigns, campaignId]);

  async function submit() {
    if (!campaignId) {
      toast.error("Select a campaign");
      return;
    }
    setSubmitting(true);
    try {
      if (isDemo) {
        for (const id of leadIds) {
          patchLead(id, {
            campaignId,
            pushToInstantly: "pushed",
            channel: "cold_email",
          });
        }
      }
      const result = await pushLeadsToCampaign(campaignId, leadIds, { isDemo });
      if (result.ok) {
        onOpenChange(false);
        onSuccess?.();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" showCloseButton>
        <DialogHeader>
          <DialogTitle>Add to outreach campaign</DialogTitle>
          <DialogDescription>
            Push {leadIds.length} lead{leadIds.length === 1 ? "" : "s"} to an Instantly campaign.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Label className="text-xs">Campaign</Label>
          <Select value={campaignId} onValueChange={(v) => v && setCampaignId(v)}>
            <SelectTrigger>
              <SelectValue placeholder="Select campaign" />
            </SelectTrigger>
            <SelectContent>
              {coldCampaigns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {coldCampaigns.length === 0 && (
            <p className="text-xs text-muted-foreground">Create a campaign under Email outreach first.</p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={submitting || coldCampaigns.length === 0}
            onClick={() => void submit()}
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Add to campaign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
