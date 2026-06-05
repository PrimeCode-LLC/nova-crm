import { toast } from "sonner";

export type PushLeadsResult = {
  ok: boolean;
  pushed?: number;
  skipped?: { id: string; reason: string }[];
  error?: string;
};

export async function pushLeadsToCampaign(
  campaignId: string,
  leadIds: string[],
  opts?: { isDemo?: boolean; onDemoSuccess?: () => void },
): Promise<PushLeadsResult> {
  if (opts?.isDemo) {
    opts.onDemoSuccess?.();
    toast.success(`Added ${leadIds.length} lead(s) to campaign (demo)`);
    return { ok: true, pushed: leadIds.length };
  }

  const res = await fetch(`/api/integrations/instantly/campaigns/${campaignId}/leads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leadIds }),
  });
  const data = (await res.json().catch(() => ({}))) as PushLeadsResult & {
    error?: string;
    skipped?: { id: string; reason: string }[];
  };

  if (!res.ok) {
    const msg = typeof data.error === "string" ? data.error : "Could not add leads";
    toast.error(msg);
    return { ok: false, error: msg, skipped: data.skipped };
  }

  const pushed = Number(data.pushed ?? leadIds.length);
  const skipped = data.skipped ?? [];
  if (skipped.length > 0) {
    toast.success(`Pushed ${pushed} lead(s)`, {
      description: `${skipped.length} skipped (e.g. missing email).`,
    });
  } else {
    toast.success(`Pushed ${pushed} lead(s) to Instantly, merge tags will use their CRM data.`);
  }

  return { ok: true, pushed, skipped };
}
