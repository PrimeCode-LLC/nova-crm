import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import {
  buildProspectImportCsv,
  buildProspectImportWorkbook,
} from "@/lib/imports/prospect-template";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const guard = await guardAdminFeature("import");
  if (!guard.ok) return guard.response;

  const format = new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
  if (format === "csv") {
    return new Response(buildProspectImportCsv(), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="Nova_Prospect_Import_Template.csv"',
        "Cache-Control": "private, no-store",
      },
    });
  }

  const workbook = await buildProspectImportWorkbook();
  const body = workbook.buffer.slice(
    workbook.byteOffset,
    workbook.byteOffset + workbook.byteLength,
  ) as ArrayBuffer;
  return new Response(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Nova_Prospect_Import_Template.xlsx"',
      "Cache-Control": "private, no-store",
    },
  });
}
