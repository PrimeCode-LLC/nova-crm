"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { SequenceEditor } from "@/components/outreach/sequence-editor";
import {
  DEFAULT_SEQUENCE_STEP,
  draftsToInstantlySteps,
  remoteSequenceToDrafts,
  type SequenceStepDraft,
} from "@/lib/integrations/instantly/sequence-utils";
import { parseInstantlyId } from "@/lib/integrations/instantly/refs";
import type { InstantlyCampaign } from "@/lib/integrations/instantly/types";

export function CampaignSequencePanel({
  campaignId,
  externalRef,
  instantlyId,
  connected,
  isDemo,
}: {
  campaignId: string;
  externalRef?: string;
  instantlyId?: string;
  connected: boolean;
  isDemo: boolean;
}) {
  const { updateCampaign } = useWorkspace();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [steps, setSteps] = React.useState<SequenceStepDraft[]>([{ ...DEFAULT_SEQUENCE_STEP }]);
  const [dirty, setDirty] = React.useState(false);
  const linked = Boolean(parseInstantlyId(externalRef, instantlyId));

  const loadRemote = React.useCallback(async () => {
    if (isDemo || !connected || !linked) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/integrations/instantly/campaigns/${campaignId}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(typeof d.error === "string" ? d.error : "Could not load sequence");
        return;
      }
      const data = (await res.json()) as { remote?: InstantlyCampaign | null };
      setSteps(remoteSequenceToDrafts(data.remote));
      setDirty(false);
    } finally {
      setLoading(false);
    }
  }, [campaignId, connected, isDemo, linked]);

  React.useEffect(() => {
    void loadRemote();
  }, [loadRemote]);

  function onStepsChange(next: SequenceStepDraft[]) {
    setSteps(next);
    setDirty(true);
  }

  async function saveSequence() {
    for (const s of steps) {
      if (!s.subject.trim() || !s.body.trim()) {
        toast.error("Each step needs a subject and body");
        return;
      }
    }

    setSaving(true);
    try {
      if (isDemo || !connected || !linked) {
        updateCampaign(campaignId, { sequenceSummary: { steps: steps.length } });
        toast.success("Sequence saved locally (demo)");
        setDirty(false);
        return;
      }

      const res = await fetch(`/api/integrations/instantly/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steps: draftsToInstantlySteps(steps),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Could not save sequence");
        return;
      }
      updateCampaign(campaignId, {
        sequenceSummary: { steps: steps.length },
      });
      toast.success("Sequence saved to Instantly");
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  if (!linked && !isDemo) {
    return (
      <p className="text-sm text-muted-foreground">
        This campaign is not linked to Instantly. Sync from Instantly or create a new campaign with the wizard to
        edit sequences here.
      </p>
    );
  }

  if (!connected && !isDemo) {
    return (
      <p className="text-sm text-muted-foreground">
        Connect Instantly in Settings → Integrations to load and edit the email sequence.
      </p>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading sequence from Instantly…
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={saving || !dirty} onClick={() => void saveSequence()}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Save sequence
        </Button>
        <Button size="sm" variant="outline" disabled={loading || saving} onClick={() => void loadRemote()}>
          Reload from Instantly
        </Button>
        {dirty && <span className="text-xs text-warning">Unsaved changes</span>}
      </div>
      <SequenceEditor steps={steps} onChange={onStepsChange} disabled={saving} />
    </div>
  );
}
