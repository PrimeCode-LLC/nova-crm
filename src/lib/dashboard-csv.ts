/** Download a minimal dashboard KPI snapshot as CSV (UTF-8). */
export function downloadDashboardKpiCsv(rows: { label: string; value: string }[], filenameBase = "nova-dashboard") {
  const header = "metric,value";
  const body = rows.map((r) => `${escapeCsv(r.label)},${escapeCsv(r.value)}`).join("\n");
  const csv = `${header}\n${body}\n`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameBase}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeCsv(s: string) {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
