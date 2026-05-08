import type { Lead } from "@/lib/types";

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Build CSV for the given leads (typically filtered table rows). */
export function leadsToCsv(rows: readonly Lead[]): string {
  const headers = [
    "Contact",
    "Title",
    "Company",
    "Email",
    "Channel",
    "Stage",
    "Owner id",
    "Created by id",
    "Temperature",
    "Priority",
    "Value",
    "Idle days",
    "Last activity",
  ];
  const lines = rows.map((r) =>
    [
      r.contactName,
      r.contactTitle ?? "",
      r.companyName,
      r.contactEmail ?? "",
      r.channel,
      r.stage,
      r.ownerId,
      r.createdById ?? "",
      r.temperature,
      r.priority,
      r.estimatedValue ?? "",
      r.idleDays ?? "",
      r.lastActivityAt ?? r.updatedAt,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [headers.join(","), ...lines].join("\n");
}

export function downloadLeadsCsv(rows: readonly Lead[], basename = "nova-crm-leads"): void {
  if (typeof window === "undefined") return;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const csv = `\uFEFF${leadsToCsv(rows)}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${basename}-${stamp}.csv`;
  a.rel = "noopener";
  a.click();
  URL.revokeObjectURL(url);
}
