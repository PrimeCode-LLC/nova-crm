import { toast } from "sonner";

export type ImportLeadsFromInstantlyResult = {
  ok: boolean;
  total?: number;
  linked?: number;
  created?: number;
  skipped?: number;
  error?: string;
};

export async function importLeadsFromInstantly(
  campaignId: string,
  opts?: { isDemo?: boolean },
): Promise<ImportLeadsFromInstantlyResult> {
  if (opts?.isDemo) {
    toast.success("Leads imported from Instantly (demo)");
    return { ok: true, total: 0, linked: 0, created: 0, skipped: 0 };
  }

  const res = await fetch(`/api/integrations/instantly/campaigns/${campaignId}/sync-leads`, {
    method: "POST",
  });
  const data = (await res.json().catch(() => ({}))) as ImportLeadsFromInstantlyResult & {
    error?: string;
  };

  if (!res.ok) {
    const msg = typeof data.error === "string" ? data.error : "Could not import leads";
    toast.error(msg);
    return { ok: false, error: msg };
  }

  const linked = Number(data.linked ?? 0);
  const created = Number(data.created ?? 0);
  const total = Number(data.total ?? 0);
  const skipped = Number(data.skipped ?? 0);

  toast.success(`Imported ${linked + created} lead(s) from Instantly`, {
    description: `${total} in Instantly · ${linked} linked to existing CRM · ${created} new${skipped > 0 ? ` · ${skipped} skipped (no email)` : ""}`,
  });

  return { ok: true, total, linked, created, skipped };
}
