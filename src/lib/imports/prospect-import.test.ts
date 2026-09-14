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
  it("keeps a unique 53-column registry aligned to the New prospect form", () => {
    expect(PROSPECT_IMPORT_FIELDS).toHaveLength(53);
    expect(new Set(PROSPECT_IMPORT_HEADERS).size).toBe(53);
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
  }, 15_000);

  it("accepts a single Data sheet workbook without helper sheets", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Data");
    const values: Record<string, string> = {
      "Company Name": "Solo Sheet Co",
      "Company Domain": "solo.example",
      "First Name": "Sam",
      "Last Name": "Lee",
      "Company Email": "sam@solo.example",
    };
    PROSPECT_IMPORT_HEADERS.forEach((header, index) => {
      sheet.getCell(2, index + 1).value = header;
      sheet.getCell(3, index + 1).value = values[header] ?? "";
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const parsed = await parseProspectImportFile("solo.xlsx", Buffer.from(buffer));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.issues).toEqual([]);
    expect(parsed.rows[0]!.normalized.companyName).toBe("Solo Sheet Co");
  }, 15_000);

  it("accepts Excel HYPERLINK formula cells using cached results", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Data");
    const values: Record<string, unknown> = {
      "Company Name": "Link Co",
      "Company Domain": "link.example",
      "First Name": "Lee",
      "Last Name": "Chen",
      "Website URL": {
        text: "link.example",
        hyperlink: "https://link.example",
      },
      "Contact LinkedIn URL": {
        formula: 'HYPERLINK("https://linkedin.com/in/lee-chen","https://linkedin.com/in/lee-chen")',
        result: "https://linkedin.com/in/lee-chen",
      },
    };
    PROSPECT_IMPORT_HEADERS.forEach((header, index) => {
      sheet.getCell(2, index + 1).value = header;
      sheet.getCell(3, index + 1).value = (values[header] ?? "") as ExcelJS.CellValue;
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const parsed = await parseProspectImportFile("links.xlsx", Buffer.from(buffer));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.issues).toEqual([]);
    expect(parsed.rows[0]!.normalized.contactLinkedIn).toBe("https://linkedin.com/in/lee-chen");
    expect(parsed.rows[0]!.normalized.website).toBe("https://link.example/");
  }, 15_000);

  it("prefers hyperlink URL when Excel shows a friendly label", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Data");
    const values: Record<string, unknown> = {
      "Company Name": "Label Co",
      "Company Domain": "label.example",
      "First Name": "Pat",
      "Last Name": "Ng",
      "Contact LinkedIn URL": {
        text: "Pat Ng",
        hyperlink: "https://linkedin.com/in/pat-ng",
      },
    };
    PROSPECT_IMPORT_HEADERS.forEach((header, index) => {
      sheet.getCell(2, index + 1).value = header;
      sheet.getCell(3, index + 1).value = (values[header] ?? "") as ExcelJS.CellValue;
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const parsed = await parseProspectImportFile("label.xlsx", Buffer.from(buffer));
    expect(parsed.rows[0]!.issues).toEqual([]);
    expect(parsed.rows[0]!.normalized.contactLinkedIn).toBe("https://linkedin.com/in/pat-ng");
  }, 15_000);

  it("accepts Excel serial dates and skips blank CSV rows", async () => {
    // 2025-11-19 => Excel serial 45980 (1899-12-30 epoch).
    const csv = `${buildProspectImportCsv()}${csvRow({
      "Company Name": "Date Co",
      "Company Domain": "date.example",
      "First Name": "Ada",
      "Last Name": "Lovelace",
      Phone: "+15555550123",
      "Last Website Activity Date": "45980",
    })}\r\n${",".repeat(PROSPECT_IMPORT_HEADERS.length - 1)}\r\n`;
    const parsed = await parseProspectImportFile("dates.csv", Buffer.from(csv));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.issues).toEqual([]);
    expect(parsed.rows[0]!.normalized.lastWebsiteActivityAt).toBe("2025-11-19");
  });
});

describe("prospect import parsing", () => {
  it("normalizes a valid exact-header CSV row", async () => {
    const csv = `${buildProspectImportCsv()}${csvRow({
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
      companyDomain: "acme.com",
      companyEmail: "jane@acme.com",
      channel: "cold_email",
      stage: "new",
      temperature: "warm",
      priority: "high",
    });
  });

  it("derives company domain from website when domain is blank", async () => {
    const csv = `${buildProspectImportCsv()}${csvRow({
      "Company Name": "Acme Inc.",
      "Website URL": "https://www.acme.com/about",
      "First Name": "Jane",
      "Last Name": "Doe",
      "Company Email": "jane@other.example",
    })}\r\n`;
    const parsed = await parseProspectImportFile("prospects.csv", Buffer.from(csv));
    expect(parsed.rows[0]!.issues).toEqual([]);
    expect(parsed.rows[0]!.normalized.companyDomain).toBe("acme.com");
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
      "Email Verification Status": "Verified",
      "Revenue Range": "$100M – $200M",
      "Company Size": "500+",
      "Last Website Activity Date": "November 19, 2025",
    })}\r\n`;
    const parsed = await parseProspectImportFile("prospects.csv", Buffer.from(csv));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.issues).toEqual([]);
    expect(parsed.rows[0]!.normalized).toMatchObject({
      emailVerificationStatus: "verified",
      revenueRange: "100m_500m",
      companySize: "501-1000",
      lastWebsiteActivityAt: "2025-11-19",
    });
  });

  it("requires company, names, domain (or derivable), and a contact identity", async () => {
    const csv = `${buildProspectImportCsv()}${csvRow({ Industry: "Software" })}\r\n`;
    const parsed = await parseProspectImportFile("prospects.csv", Buffer.from(csv));
    expect(parsed.rows[0]!.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "required",
        "domain_required",
        "contact_identity_required",
      ]),
    );
  });

  it("accepts website URLs without an explicit scheme", async () => {
    const csv = `${buildProspectImportCsv()}${csvRow({
      "Company Name": "Acme Inc.",
      "Company Domain": "acme.com",
      "Website URL": "www.acme.com/about",
      "First Name": "Jane",
      "Last Name": "Doe",
      "Contact LinkedIn URL": "linkedin.com/in/jane-doe",
    })}\r\n`;
    const parsed = await parseProspectImportFile("prospects.csv", Buffer.from(csv));
    expect(parsed.rows[0]!.issues).toEqual([]);
    expect(parsed.rows[0]!.normalized.website).toBe("https://www.acme.com/about");
    expect(parsed.rows[0]!.normalized.contactLinkedIn).toBe("https://linkedin.com/in/jane-doe");
  });

  it("rejects formula-like CSV values", async () => {
    const csv = `${buildProspectImportCsv()}${csvRow({
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
    headers[0] = "Business";
    await expect(
      parseProspectImportFile("prospects.csv", Buffer.from(`${headers.join(",")}\r\n`)),
    ).rejects.toThrow('Column 1 must be "Company Name"');
  });

  it("accepts the configured 10,000-row limit", async () => {
    const rows = Array.from({ length: 10_000 }, (_, index) =>
      csvRow({
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
