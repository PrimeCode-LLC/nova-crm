"use client";

import * as React from "react";
import Papa from "papaparse";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  CloudUpload,
  ClipboardPaste,
  CheckCircle2,
  AlertCircle,
  Upload,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import {
  collectNormalizedEmailsFromWorkspace,
  filterRowsForCsvImport,
  ingestMappedRowAsLead,
  mapSpreadsheetRowToTargets,
  rowHasImportIdentity,
} from "@/lib/workspace-csv-import";

const STEPS = [
  { label: "Upload", description: "Choose your file" },
  { label: "Map columns", description: "Match to CRM fields" },
  { label: "Review & Import", description: "Confirm and run" },
];

const SAMPLE_SOURCE_FIELDS = [
  "Company Name",
  "Email",
  "First Name",
  "Last Name",
  "Title / Role",
  "LinkedIn URL",
  "Industry",
  "Company Size",
  "Website",
  "Phone",
];

const TARGET_FIELDS = [
  { label: "Company Name", value: "companyName" },
  { label: "Contact Email", value: "contactEmail" },
  { label: "First Name", value: "firstName" },
  { label: "Last Name", value: "lastName" },
  { label: "Contact Title", value: "contactTitle" },
  { label: "LinkedIn URL", value: "contactLinkedIn" },
  { label: "Industry", value: "companyIndustry" },
  { label: "Company Size", value: "companySize" },
  { label: "Company Domain", value: "companyDomain" },
  { label: "Phone", value: "phone" },
];

const DEFAULT_MAPPINGS: Record<string, string> = {
  "Company Name": "companyName",
  Email: "contactEmail",
  "First Name": "firstName",
  "Last Name": "lastName",
  "Title / Role": "contactTitle",
  "LinkedIn URL": "contactLinkedIn",
  Industry: "companyIndustry",
  "Company Size": "companySize",
  Website: "companyDomain",
  Phone: "phone",
};

const HEADER_HINTS: { value: string; patterns: string[] }[] = [
  { value: "companyName", patterns: ["company", "organization", "org", "account name", "company name"] },
  { value: "contactEmail", patterns: ["email", "e-mail", "mail"] },
  { value: "firstName", patterns: ["first name", "firstname", "given"] },
  { value: "lastName", patterns: ["last name", "lastname", "surname", "family"] },
  { value: "contactTitle", patterns: ["title", "role", "job title", "position"] },
  { value: "contactLinkedIn", patterns: ["linkedin", "linked in"] },
  { value: "companyIndustry", patterns: ["industry", "vertical", "sector"] },
  { value: "companySize", patterns: ["company size", "employees", "headcount", "size"] },
  { value: "companyDomain", patterns: ["website", "domain", "url", "company url"] },
  { value: "phone", patterns: ["phone", "mobile", "tel"] },
];

function guessMappingForHeader(header: string): string {
  const n = header.trim().toLowerCase();
  if (!n) return "skip";
  for (const tf of TARGET_FIELDS) {
    if (n === tf.label.toLowerCase() || n === tf.value.toLowerCase()) return tf.value;
  }
  if (DEFAULT_MAPPINGS[header]) return DEFAULT_MAPPINGS[header];
  for (const { value, patterns } of HEADER_HINTS) {
    if (patterns.some((p) => n === p || n.includes(p))) return value;
  }
  return "skip";
}

function buildMappingsForHeaders(headers: string[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const h of headers) {
    next[h] = guessMappingForHeader(h);
  }
  return next;
}

function parseSpreadsheetText(text: string, filename: string) {
  const lower = filename.toLowerCase();
  const isTsv = lower.endsWith(".tsv") || text.includes("\t");
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    delimiter: isTsv ? "\t" : ",",
    skipEmptyLines: "greedy",
    transformHeader: (h) => String(h ?? "").trim(),
  });
  const rawFields = parsed.meta.fields?.filter((f) => String(f ?? "").trim()) ?? [];
  const headers =
    rawFields.length > 0
      ? rawFields.map((f) => String(f).trim())
      : Object.keys(parsed.data[0] ?? {}).filter((k) => k);
  const data = (parsed.data ?? []).filter((row) =>
    Object.values(row).some((v) => String(v ?? "").trim()),
  );
  return { headers, data, parseErrors: parsed.errors };
}

function countEmailDuplicatesInFile(
  rows: Record<string, string>[],
  mappings: Record<string, string>,
): number {
  const sourceKey = Object.entries(mappings).find(([, v]) => v === "contactEmail")?.[0];
  if (!sourceKey) return 0;
  const seen = new Set<string>();
  let dup = 0;
  for (const row of rows) {
    const e = String(row[sourceKey] ?? "")
      .trim()
      .toLowerCase();
    if (!e) continue;
    if (seen.has(e)) dup++;
    else seen.add(e);
  }
  return dup;
}

const DEMO_TOTAL = 248;
const DEMO_DUP = 11;
const DEMO_CREATE = 237;

export default function AdminImportPage() {
  const { addAccount, addContact, addLead, currentUserId, users, leads, contacts } = useWorkspace();
  const [step, setStep] = React.useState(0);
  const [sourceColumns, setSourceColumns] = React.useState<string[]>(SAMPLE_SOURCE_FIELDS);
  const [mappings, setMappings] = React.useState<Record<string, string>>(() => ({
    ...DEFAULT_MAPPINGS,
  }));
  const [parsedRows, setParsedRows] = React.useState<Record<string, string>[] | null>(null);
  const [duplicateHandling, setDuplicateHandling] = React.useState("skip");
  const [importing, setImporting] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const importStats = React.useMemo(() => {
    if (!parsedRows) {
      return { total: DEMO_TOTAL, duplicates: DEMO_DUP, toCreate: DEMO_CREATE };
    }
    const total = parsedRows.length;
    const duplicates = countEmailDuplicatesInFile(parsedRows, mappings);
    const toCreateSkip = Math.max(0, total - duplicates);
    return { total, duplicates, toCreate: toCreateSkip };
  }, [parsedRows, mappings]);

  const willCreateCount = React.useMemo(() => {
    if (duplicateHandling === "create") return importStats.total;
    if (duplicateHandling === "merge") return Math.max(0, importStats.total - importStats.duplicates);
    return importStats.toCreate;
  }, [duplicateHandling, importStats]);

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function applyParsed(headers: string[], data: Record<string, string>[], label?: string) {
    const inferred =
      headers.length > 0 ? headers : data[0] ? Object.keys(data[0]) : [];
    if (!inferred.length) {
      toast.error("No columns found. Add a header row or check the delimiter.");
      return;
    }
    if (data.length === 0) {
      toast.error("No data rows found in that file.");
      return;
    }
    setSourceColumns(inferred);
    setMappings(buildMappingsForHeaders(inferred));
    setParsedRows(data);
    const n = data.length;
    toast.success(
      label ? `Loaded ${n} row${n === 1 ? "" : "s"} from ${label}` : `Loaded ${n} row${n === 1 ? "" : "s"}`,
    );
    setStep(1);
  }

  function processTextAsImport(text: string, filename: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      toast.error("Clipboard was empty.");
      return;
    }
    const { headers, data, parseErrors } = parseSpreadsheetText(trimmed, filename);
    if (parseErrors.length) {
      const fatal = parseErrors.find((e) => e.type === "Quotes" || e.type === "Delimiter");
      if (fatal) {
        toast.error(fatal.message || "Could not parse that data.");
        return;
      }
    }
    const h = headers.length ? headers : data[0] ? Object.keys(data[0]) : [];
    applyParsed(h, data, filename || "clipboard");
  }

  async function processFile(file: File) {
    try {
      const text = await file.text();
      const { headers, data, parseErrors } = parseSpreadsheetText(text, file.name);
      if (parseErrors.length) {
        const fatal = parseErrors.find((e) => e.type === "Quotes");
        if (fatal) {
          toast.error(fatal.message || "Could not parse that file.");
          return;
        }
      }
      const h = headers.length ? headers : data[0] ? Object.keys(data[0]) : [];
      applyParsed(h, data, file.name);
    } catch {
      toast.error("Could not read that file.");
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void processFile(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const ok =
      file.name.toLowerCase().endsWith(".csv") ||
      file.name.toLowerCase().endsWith(".tsv") ||
      file.type === "text/csv" ||
      file.type === "text/tab-separated-values" ||
      file.type === "text/plain";
    if (!ok) {
      toast.error("Drop a CSV or TSV file.");
      return;
    }
    void processFile(file);
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      processTextAsImport(text, "clipboard");
    } catch {
      toast.error("Clipboard access denied or unavailable. Paste in a secure context (HTTPS) and allow permission.");
    }
  }

  function continueWithSample() {
    setParsedRows(null);
    setSourceColumns([...SAMPLE_SOURCE_FIELDS]);
    setMappings({ ...DEFAULT_MAPPINGS });
    setDuplicateHandling("skip");
    setStep(1);
    toast.message("Using built-in sample column layout", {
      description: "Map fields or continue to review, row counts are illustrative.",
    });
  }

  function handleImport() {
    if (!parsedRows?.length) {
      toast.error("Load a CSV or paste data before importing.");
      return;
    }
    const ownerId = currentUserId || users[0]?.id;
    if (!ownerId) {
      toast.error("No owner is available for imported leads. Open the app with a signed-in user or switch to Demo.");
      return;
    }
    const workspaceEmails = collectNormalizedEmailsFromWorkspace(leads, contacts);
    const rows = filterRowsForCsvImport(parsedRows, mappings, duplicateHandling, workspaceEmails);
    const usable = rows.filter((row) => rowHasImportIdentity(mapSpreadsheetRowToTargets(row, mappings)));
    if (usable.length === 0) {
      toast.error("No rows to import. Check column mapping and duplicate rules.");
      return;
    }
    setImporting(true);
    try {
      for (const row of usable) {
        const mapped = mapSpreadsheetRowToTargets(row, mappings);
        ingestMappedRowAsLead(mapped, ownerId, addAccount, addContact, addLead);
      }
      toast.success(`${usable.length} lead${usable.length === 1 ? "" : "s"} imported successfully`);
      setStep(0);
      setParsedRows(null);
      setSourceColumns([...SAMPLE_SOURCE_FIELDS]);
      setMappings({ ...DEFAULT_MAPPINGS });
      setDuplicateHandling("skip");
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Import Leads"
        description="Bulk import leads from CSV, spreadsheet, or paste."
      />
      <PageBody>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,text/csv,text/tab-separated-values,text/plain"
          className="sr-only"
          aria-hidden
          onChange={onInputChange}
        />

        {/* Stepper */}
        <div className="flex flex-wrap items-center gap-0">
          {STEPS.map((s, i) => (
            <React.Fragment key={s.label}>
              <button
                type="button"
                onClick={() => setStep(i)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  step === i
                    ? "bg-primary/10 text-primary"
                    : i < step
                      ? "text-success hover:bg-muted/30"
                      : "text-muted-foreground hover:bg-muted/30",
                )}
              >
                <div
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold border shrink-0",
                    step === i
                      ? "bg-primary text-primary-foreground border-primary"
                      : i < step
                        ? "bg-success/10 text-success border-success/30"
                        : "bg-muted text-muted-foreground border-transparent",
                  )}
                >
                  {i < step ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <div className="hidden sm:block text-left">
                  <div className="font-medium">{s.label}</div>
                  <div className="text-[11px] opacity-70">{s.description}</div>
                </div>
              </button>
              {i < STEPS.length - 1 && (
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 mx-1 shrink-0" />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Step 1: Upload */}
        {step === 0 && (
          <div className="space-y-4">
            <div
              role="button"
              tabIndex={0}
              aria-label="Drop a CSV or TSV file, or press Enter to browse"
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openFilePicker();
                }
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
              }}
              onDrop={onDrop}
              onClick={() => openFilePicker()}
              className={cn(
                "rounded-xl border-2 border-dashed transition-colors p-12 flex flex-col items-center justify-center gap-4 bg-muted/10 cursor-pointer",
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/20 hover:border-primary/40",
              )}
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <CloudUpload className="h-7 w-7" />
              </div>
              <div className="text-center pointer-events-none">
                <p className="text-sm font-medium">
                  Drop your file here, or{" "}
                  <span className="text-primary underline">browse</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  CSV, TSV, or paste rows directly
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" onClick={() => openFilePicker()}>
                <Upload className="h-4 w-4" /> Upload file
              </Button>
              <Button type="button" variant="outline" onClick={() => void pasteFromClipboard()}>
                <ClipboardPaste className="h-4 w-4" /> Paste from clipboard
              </Button>
            </div>

            <div className="flex justify-end">
              <Button type="button" size="sm" onClick={continueWithSample}>
                Continue with sample data <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Map columns */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-md border overflow-hidden">
              <div className="bg-muted/30 px-4 py-2.5 flex items-center gap-4 text-xs font-medium uppercase tracking-wide text-muted-foreground border-b">
                <span className="flex-1">Source column</span>
                <span className="flex-1">→</span>
                <span className="flex-1">CRM field</span>
              </div>
              <div className="divide-y">
                {sourceColumns.map((sf) => (
                  <div
                    key={sf}
                    className="flex items-center gap-4 px-4 py-2.5 hover:bg-muted/10"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-mono text-muted-foreground break-all">
                        {sf}
                      </span>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <Select
                        value={mappings[sf] ?? "skip"}
                        onValueChange={(v) =>
                          setMappings((prev) => ({ ...prev, [sf]: v ?? "skip" }))
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="skip" className="text-muted-foreground">
                            Skip this column
                          </SelectItem>
                          {TARGET_FIELDS.map((tf) => (
                            <SelectItem key={tf.value} value={tf.value}>
                              {tf.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-between flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setStep(0)}>
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
              <Button type="button" size="sm" onClick={() => setStep(2)}>
                Review import <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Review & Import */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-lg border p-5 space-y-4 bg-muted/10">
              <div className="text-sm font-medium">Import summary</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { label: "Total rows", value: String(importStats.total), color: "text-foreground" },
                  {
                    label: "Duplicates detected",
                    value: String(importStats.duplicates),
                    hint: "In-file duplicate emails (mapped to Contact Email)",
                    color: "text-warning",
                  },
                  {
                    label:
                      duplicateHandling === "merge"
                        ? "Net new / updates (est.)"
                        : duplicateHandling === "create"
                          ? "Rows to write"
                          : "Will be created",
                    value: String(willCreateCount),
                    color: "text-success",
                  },
                ].map((s) => (
                  <div key={s.label} className="space-y-0.5">
                    <div className={`text-2xl font-semibold tabular-nums ${s.color}`}>
                      {s.value}
                    </div>
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                    {s.hint && (
                      <div className="text-[11px] text-muted-foreground/70">{s.hint}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border p-4 space-y-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Duplicate handling
              </div>
              <RadioGroup
                value={duplicateHandling}
                onValueChange={setDuplicateHandling}
                className="space-y-2"
              >
                {[
                  {
                    value: "skip",
                    label: "Skip duplicates",
                    desc: "Keep existing records, discard incoming duplicates.",
                  },
                  {
                    value: "merge",
                    label: "Merge duplicates",
                    desc: "Update existing records with new data. Existing fields take priority.",
                  },
                  {
                    value: "create",
                    label: "Create anyway",
                    desc: "Import all rows regardless. May create duplicate leads.",
                  },
                ].map((opt) => (
                  <div key={opt.value} className="flex items-start gap-3">
                    <RadioGroupItem value={opt.value} id={`dup-${opt.value}`} className="mt-0.5" />
                    <Label htmlFor={`dup-${opt.value}`} className="cursor-pointer space-y-0.5">
                      <span className="text-sm font-medium">{opt.label}</span>
                      <p className="text-xs text-muted-foreground font-normal">{opt.desc}</p>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            <div className="flex items-center gap-2 p-3 rounded-md bg-warning/5 border border-warning/20 text-xs text-warning">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>
                This action imports <strong>{willCreateCount}</strong> lead
                {willCreateCount === 1 ? "" : "s"}. Review your column mapping before proceeding.
              </span>
            </div>

            <div className="flex justify-between flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setStep(1)}>
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
              <Button type="button" size="sm" onClick={() => handleImport()} disabled={importing}>
                {importing ? (
                  <>Importing…</>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Import {willCreateCount} lead
                    {willCreateCount === 1 ? "" : "s"}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}
