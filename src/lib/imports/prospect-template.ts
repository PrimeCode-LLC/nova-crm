import ExcelJS from "exceljs";
import {
  PROSPECT_IMPORT_DATA_SHEET,
  PROSPECT_IMPORT_FIELDS,
  PROSPECT_IMPORT_HEADERS,
  PROSPECT_IMPORT_MAX_ROWS,
  PROSPECT_IMPORT_TEMPLATE_VERSION,
} from "@/lib/imports/prospect-import-schema";

const HEADER_FILL = "FF1F4E78";
const REQUIRED_FILL = "FFFFE699";
const SECTION_FILL = "FFD9EAF7";

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function buildProspectImportCsv(): string {
  return `\uFEFF${PROSPECT_IMPORT_HEADERS.map(csvCell).join(",")}\r\n`;
}

function addSectionHeader(sheet: ExcelJS.Worksheet): void {
  let start = 1;
  let current = PROSPECT_IMPORT_FIELDS[0]!.section;

  for (let index = 1; index <= PROSPECT_IMPORT_FIELDS.length; index++) {
    const next = PROSPECT_IMPORT_FIELDS[index]?.section;
    if (next !== current) {
      sheet.mergeCells(1, start, 1, index);
      const cell = sheet.getCell(1, start);
      cell.value = current;
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.font = { bold: true, color: { argb: "FF17324D" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_FILL } };
      start = index + 1;
      current = next ?? current;
    }
  }
}

function configureDataSheet(sheet: ExcelJS.Worksheet): void {
  const validations = (
    sheet as ExcelJS.Worksheet & {
      dataValidations: {
        add(address: string, validation: ExcelJS.DataValidation): void;
      };
    }
  ).dataValidations;
  addSectionHeader(sheet);
  const header = sheet.getRow(2);
  header.values = PROSPECT_IMPORT_HEADERS;
  header.height = 34;
  header.eachCell((cell, columnNumber) => {
    const field = PROSPECT_IMPORT_FIELDS[columnNumber - 1]!;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.note = field.required
      ? `Required. ${field.description}`
      : field.description;
  });

  sheet.views = [{ state: "frozen", ySplit: 2, xSplit: 0 }];
  sheet.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2, column: PROSPECT_IMPORT_FIELDS.length },
  };

  PROSPECT_IMPORT_FIELDS.forEach((field, index) => {
    const column = sheet.getColumn(index + 1);
    column.width = Math.min(34, Math.max(15, field.header.length + 3));
    if (field.required) {
      for (let row = 3; row <= 102; row++) {
        const cell = sheet.getCell(row, index + 1);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: REQUIRED_FILL } };
      }
    }
    if (field.type === "date") {
      column.numFmt = "yyyy-mm-dd";
    }
    if (field.values?.length) {
      const escaped = field.values.join(",").replace(/"/g, '""');
      validations.add(`${column.letter}3:${column.letter}${PROSPECT_IMPORT_MAX_ROWS + 2}`, {
        type: "list",
        allowBlank: !field.required,
        formulae: [`"${escaped}"`],
        showErrorMessage: true,
        errorTitle: "Invalid value",
        error: `Choose one of the allowed values for ${field.header}.`,
      });
    } else if (field.type === "boolean") {
      validations.add(`${column.letter}3:${column.letter}${PROSPECT_IMPORT_MAX_ROWS + 2}`, {
        type: "list",
        allowBlank: true,
        formulae: ['"true,false"'],
        showErrorMessage: true,
        errorTitle: "Invalid value",
        error: "Choose true or false.",
      });
    }
  });
}

function configureInstructionsSheet(sheet: ExcelJS.Worksheet): void {
  sheet.columns = [{ width: 28 }, { width: 100 }];
  sheet.addRow(["Nova Prospect Import", `Template version ${PROSPECT_IMPORT_TEMPLATE_VERSION}`]);
  sheet.addRow(["Maximum rows", PROSPECT_IMPORT_MAX_ROWS]);
  sheet.addRow(["Required fields", "Company Name, First Name, and Last Name."]);
  sheet.addRow([
    "Company domain",
    "Optional. If blank, derived from Website URL or Company Email (same as the New prospect form).",
  ]);
  sheet.addRow([
    "Contact identity",
    "Provide at least one: Company Email, Personal Email, Contact LinkedIn URL, or Phone.",
  ]);
  sheet.addRow(["Lists", "Separate tech stack values with semicolons."]);
  sheet.addRow(["Dates", "Use YYYY-MM-DD."]);
  sheet.addRow(["Do not modify", "Do not rename, add, remove, merge, or reorder Data sheet columns."]);
  sheet.addRow(["Prospect behavior", "Every imported row is treated as a prospect (matches New prospect form fields)."]);
  sheet.addRow([
    "Example",
    "Examples are documented here rather than in the Data sheet so sample data cannot be imported accidentally.",
  ]);
  sheet.addRow(["Example company", "Acme Robotics Inc."]);
  sheet.addRow(["Example domain", "acmerobotics.com (or leave blank and set Website URL)"]);
  sheet.addRow(["Example contact", "Jane Doe; jane.doe@acmerobotics.com"]);
  sheet.getRow(1).font = { bold: true, size: 16 };
  sheet.getColumn(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function configureAllowedValuesSheet(sheet: ExcelJS.Worksheet): void {
  sheet.columns = [
    { header: "Column", key: "column", width: 34 },
    { header: "Allowed values", key: "values", width: 100 },
    { header: "Description", key: "description", width: 80 },
  ];
  for (const field of PROSPECT_IMPORT_FIELDS) {
    sheet.addRow({
      column: field.header,
      values:
        field.values?.join("; ") ??
        (field.type === "boolean" ? "true; false" : ""),
      description: field.description,
    });
  }
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = "A1:C1";
}

export async function buildProspectImportWorkbook(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Nova CRM";
  workbook.title = "Nova CRM Prospect Import Template";
  workbook.subject = `Prospect import template version ${PROSPECT_IMPORT_TEMPLATE_VERSION}`;
  workbook.created = new Date();
  workbook.modified = new Date();

  configureDataSheet(workbook.addWorksheet(PROSPECT_IMPORT_DATA_SHEET));
  configureInstructionsSheet(workbook.addWorksheet("Instructions"));
  configureAllowedValuesSheet(workbook.addWorksheet("Allowed Values"));

  const output = await workbook.xlsx.writeBuffer();
  return new Uint8Array(output);
}
