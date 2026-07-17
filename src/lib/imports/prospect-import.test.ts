import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  PROSPECT_IMPORT_FIELDS,
  PROSPECT_IMPORT_HEADERS,
} from "@/lib/imports/prospect-import-schema";
import {
  buildProspectImportCsv,
  buildProspectImportWorkbook,
} from "@/lib/imports/prospect-template";
import { parseProspectImportFile } from "@/lib/imports/prospect-import-parse";
import { buildActivityInboxNotifications } from "@/lib/inbox-activity-notifications";

function csvRow(values: Record<string, string>): string {
  return PROSPECT_IMPORT_HEADERS.map((header) => {
    const value = values[header] ?? "";
    return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(",");
}

describe("prospect import template", () => {
  it("keeps a unique 74-column registry", () => {
    expect(PROSPECT_IMPORT_FIELDS).toHaveLength(74);
    expect(new Set(PROSPECT_IMPORT_HEADERS).size).toBe(74);
  });

  it("generates the official workbook without an importable sample row", async () => {
    const buffer = await buildProspectImportWorkbook();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Data",
      "Instructions",
      "Allowed Values",
    ]);
    const data = workbook.getWorksheet("Data")!;
    const headerValues = data.getRow(2).values as ExcelJS.CellValue[];
    expect(headerValues.slice(1)).toEqual(PROSPECT_IMPORT_HEADERS);
    expect(data.actualRowCount).toBe(2);
  });

  it("round-trips a completed official XLSX template", async () => {
    const template = await buildProspectImportWorkbook();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(template as never);
    const values: Record<string, string> = {
      "Record Type": "prospect",
      "Company Name": "Acme Inc.",
      "Company Domain": "acme.example",
      "First Name": "Jane",
      "Last Name": "Doe",
      "Contact LinkedIn URL": "https://linkedin.com/in/jane-doe",
    };
    workbook.getWorksheet("Data")!.getRow(3).values =
      PROSPECT_IMPORT_HEADERS.map((header) => values[header] ?? "");
    const completed = await workbook.xlsx.writeBuffer();
    const parsed = await parseProspectImportFile(
      "prospects.xlsx",
      Buffer.from(completed),
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.issues).toEqual([]);
    expect(parsed.rows[0]!.normalized.companyDomain).toBe("acme.example");
  });
});

describe("prospect import parsing", () => {
  it("normalizes a valid exact-header CSV row", async () => {
    const csv = `${buildProspectImportCsv()}${csvRow({
      "Record Type": "Prospect",
      "Company Name": "Acme Inc.",
      "Company Domain": "https://www.acme.com/path",
      "First Name": "Jane",
      "Last Name": "Doe",
      "Company Email": "JANE@ACME.COM",
      Channel: "Cold Email",
      Stage: "New",
      Temperature: "Warm",
      Priority: "High",
    })}\r\n`;
    const parsed = await parseProspectImportFile("prospects.csv", Buffer.from(csv));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.issues).toEqual([]);
    expect(parsed.rows[0]!.normalized).toMatchObject({
      recordType: "prospect",
      companyDomain: "acme.com",
      companyEmail: "jane@acme.com",
      channel: "cold_email",
      stage: "new",
      temperature: "warm",
      priority: "high",
    });
  });

  it("accepts a CSV exported from the grouped XLSX template", async () => {
    const sectionRow = PROSPECT_IMPORT_FIELDS.map((field, index) =>
      index === 0 || PROSPECT_IMPORT_FIELDS[index - 1]!.section !== field.section
        ? field.section
        : "",
    ).join(",");
    const csv = `${sectionRow}\r\n${PROSPECT_IMPORT_HEADERS.join(",")}\r\n${csvRow({
      "Company Name": "Cryoport Systems",
      "Company Domain": "cryoport.com",
      "First Name": "Savannah",
      "Last Name": "Clark",
      "Company Email": "sfaulkinham@cryoport.com",
      "Email Verified": "Verified",
      "Revenue Range": "$100M – $200M",
      "Company Size": "500+",
      "Last Website Activity Date": "November 19, 2025",
    })}\r\n`;
    const parsed = await parseProspectImportFile("prospects.csv", Buffer.from(csv));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.issues).toEqual([]);
    expect(parsed.rows[0]!.normalized).toMatchObject({
      recordType: "prospect",
      emailVerified: true,
      emailVerificationStatus: "verified",
      revenueRange: "100m_500m",
      companySize: "501-1000",
      lastWebsiteActivityAt: "2025-11-19",
    });
  });

  it("requires company, names, domain, and a contact identity", async () => {
    const csv = `${buildProspectImportCsv()}${csvRow({ "Record Type": "Prospect" })}\r\n`;
    const parsed = await parseProspectImportFile("prospects.csv", Buffer.from(csv));
    expect(parsed.rows[0]!.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "required",
        "contact_identity_required",
      ]),
    );
  });

  it("rejects formula-like CSV values", async () => {
    const csv = `${buildProspectImportCsv()}${csvRow({
      "Record Type": "Prospect",
      "Company Name": "=HYPERLINK(\"https://example.com\")",
      "Company Domain": "example.com",
      "First Name": "Jane",
      "Last Name": "Doe",
      Phone: "+15555550100",
    })}\r\n`;
    const parsed = await parseProspectImportFile("prospects.csv", Buffer.from(csv));
    expect(parsed.rows[0]!.issues.some((issue) => issue.code === "formula_like_value")).toBe(true);
  });

  it("rejects modified template headers", async () => {
    const headers = [...PROSPECT_IMPORT_HEADERS];
    headers[1] = "Business";
    await expect(
      parseProspectImportFile("prospects.csv", Buffer.from(`${headers.join(",")}\r\n`)),
    ).rejects.toThrow('Column 2 must be "Company Name"');
  });

  it("accepts the configured 10,000-row limit", async () => {
    const rows = Array.from({ length: 10_000 }, (_, index) =>
      csvRow({
        "Record Type": "Prospect",
        "Company Name": `Company ${index}`,
        "Company Domain": `company-${index}.example.com`,
        "First Name": "Jane",
        "Last Name": `Doe${index}`,
        "Company Email": `jane.${index}@company-${index}.example.com`,
      }),
    );
    const parsed = await parseProspectImportFile(
      "prospects.csv",
      Buffer.from(`${buildProspectImportCsv()}${rows.join("\r\n")}\r\n`),
    );
    expect(parsed.rows).toHaveLength(10_000);
  });
});

describe("prospect import notification", () => {
  it("surfaces an uploader's own completed import", () => {
    const notifications = buildActivityInboxNotifications(
      [{
        id: "ar-import",
        userId: "u-1",
        channel: "website_form",
        type: "import_completed",
        occurredAt: new Date().toISOString(),
        summary: "Prospect import completed: 10 created",
      }],
      "u-1",
      [{
        id: "u-1",
        email: "owner@example.com",
        displayName: "Owner",
        roleId: "manager",
        status: "active",
        createdAt: new Date().toISOString(),
      }],
      () => undefined,
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.targetHref).toBe("/admin/import");
  });
});
