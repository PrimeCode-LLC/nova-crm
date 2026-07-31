import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  PROSPECT_IMPORT_HEADERS,
  PROSPECT_IMPORT_FIELDS,
} from "@/lib/imports/prospect-import-schema";
import {
  buildProspectExportCsv,
  buildProspectExportWorkbook,
  leadToProspectExportRow,
} from "@/lib/imports/prospect-export";
import { parseProspectImportFile } from "@/lib/imports/prospect-import-parse";
import type { Account, Contact, Lead } from "@/lib/types";

const account: Account = {
  id: "acc-1",
  name: "Acme Robotics Inc.",
  domain: "acmerobotics.com",
  industry: "Robotics",
  businessDescription: "Industrial automation",
  city: "Austin",
  state: "TX",
  country: "US",
  website: "https://acmerobotics.com",
  linkedin: "https://linkedin.com/company/acme",
  yearFounded: 2018,
  businessStatus: "active",
  size: "51-200",
  revenueRange: "10m_50m",
  websiteStatus: "live",
  onlineActivityScore: "high",
  lastWebsiteActivityAt: "2026-06-01T12:00:00.000Z",
  lastWebsiteActivityNote: "Blog refresh",
  techStack: ["React", "Node"],
  careersPageUrl: "https://acmerobotics.com/careers",
  contactCount: 1,
  leadCount: 1,
  openDealValue: 0,
  ownerId: "u1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const contact: Contact = {
  id: "c-1",
  accountId: "acc-1",
  firstName: "Jane",
  lastName: "Doe",
  fullName: "Jane Doe",
  email: "jane.doe@acmerobotics.com",
  personalEmail: "jane@example.com",
  emailVerificationStatus: "verified",
  emailVerificationSource: "millionverifier",
  phone: "+15551234567",
  linkedin: "https://linkedin.com/in/jane-doe",
  title: "VP Engineering",
  seniority: "VP",
  location: "Austin, TX",
  contactSource: "LinkedIn",
  bestContactChannel: "email",
  ownerId: "u1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const lead: Lead = {
  id: "lead-1",
  accountId: "acc-1",
  contactId: "c-1",
  channel: "cold_email",
  profileId: "prof-1",
  stage: "new",
  temperature: "warm",
  priority: "high",
  ownerId: "u1",
  intakeKind: "prospect",
  contactName: "Jane Doe",
  contactTitle: "VP Engineering",
  contactEmail: "jane.doe@acmerobotics.com",
  contactLinkedIn: "https://linkedin.com/in/jane-doe",
  companyName: "Acme Robotics Inc.",
  companyDomain: "acmerobotics.com",
  companyIndustry: "Robotics",
  companySize: "51-200",
  revenueRange: "10m_50m",
  triggerEvent: "Hiring SDRs",
  painPoints: "Outbound volume",
  doNotContact: false,
  strategyId: "strat-1",
  personaId: "persona-1",
  nextAction: "Send intro",
  notes: "Priority account",
  primaryOpportunityLabel: "Outbound platform",
  deeplyPersonalized: true,
  prospectQualifyStatus: "completed",
  personalizationNote: {
    trigger: "New careers page",
    likelyImpact: "Faster ramp",
    relevantService: "Outbound ops",
    suggestedAngle: "Hire-to-pipeline",
  },
  intentEvidence: [
    {
      id: "ev-1",
      label: "Hiring",
      category: "hiring",
      strength: "strong",
      sourceUrl: "https://acmerobotics.com/careers",
      observedAt: "2026-06-01",
      explanation: "SDR roles posted",
    },
  ],
  emailVerificationStatus: "verified",
  emailVerificationSource: "millionverifier",
  touches: 0,
  isIdle: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("prospect export", () => {
  it("uses the exact 53 import headers", () => {
    const row = leadToProspectExportRow(lead, {
      getAccountById: () => account,
      getContactById: () => contact,
      getProfileName: () => "Cold Email Default",
      getStrategyName: () => "Enterprise Outbound",
      getPersonaName: () => "VP Eng",
    });
    expect(Object.keys(row)).toHaveLength(53);
    expect(PROSPECT_IMPORT_FIELDS.map((f) => f.key).every((key) => key in row)).toBe(true);

    const csv = buildProspectExportCsv([row]);
    const headerLine = csv.replace(/^\uFEFF/, "").split(/\r?\n/)[0];
    expect(headerLine).toBe(PROSPECT_IMPORT_HEADERS.map((h) => h).join(","));
  });

  it("round-trips through the official import parser (CSV)", async () => {
    const row = leadToProspectExportRow(lead, {
      getAccountById: () => account,
      getContactById: () => contact,
      getProfileName: () => "Cold Email Default",
      getStrategyName: () => "Enterprise Outbound",
      getPersonaName: () => "VP Eng",
    });
    const parsed = await parseProspectImportFile(
      "export.csv",
      Buffer.from(buildProspectExportCsv([row])),
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.issues).toEqual([]);
    expect(parsed.rows[0]!.normalized).toMatchObject({
      companyName: "Acme Robotics Inc.",
      companyDomain: "acmerobotics.com",
      firstName: "Jane",
      lastName: "Doe",
      companyEmail: "jane.doe@acmerobotics.com",
      channel: "cold_email",
      stage: "new",
      temperature: "warm",
      priority: "high",
      doNotContact: false,
      deeplyPersonalized: true,
      prospectQualifyStatus: "completed",
      techStack: ["React", "Node"],
    });
  });

  it("builds an XLSX that the import parser accepts", async () => {
    const row = leadToProspectExportRow(lead, {
      getAccountById: () => account,
      getContactById: () => contact,
    });
    const bytes = await buildProspectExportWorkbook([row]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as never);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Data",
      "Instructions",
      "Allowed Values",
    ]);
    const data = workbook.getWorksheet("Data")!;
    expect((data.getRow(2).values as ExcelJS.CellValue[]).slice(1)).toEqual(PROSPECT_IMPORT_HEADERS);

    const parsed = await parseProspectImportFile("export.xlsx", Buffer.from(bytes));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.issues).toEqual([]);
    expect(parsed.rows[0]!.normalized.companyName).toBe("Acme Robotics Inc.");
    expect(parsed.rows[0]!.normalized.firstName).toBe("Jane");
  });
});
