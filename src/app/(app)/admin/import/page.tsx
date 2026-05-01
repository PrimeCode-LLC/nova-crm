"use client";

import * as React from "react";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

const STEPS = [
  { label: "Upload", description: "Choose your file" },
  { label: "Map columns", description: "Match to CRM fields" },
  { label: "Review & Import", description: "Confirm and run" },
];

const SOURCE_FIELDS = [
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
  "Email": "contactEmail",
  "First Name": "firstName",
  "Last Name": "lastName",
  "Title / Role": "contactTitle",
  "LinkedIn URL": "contactLinkedIn",
  "Industry": "companyIndustry",
  "Company Size": "companySize",
  "Website": "companyDomain",
  "Phone": "phone",
};

export default function AdminImportPage() {
  const [step, setStep] = React.useState(0);
  const [mappings, setMappings] = React.useState<Record<string, string>>(DEFAULT_MAPPINGS);
  const [duplicateHandling, setDuplicateHandling] = React.useState("skip");
  const [importing, setImporting] = React.useState(false);

  async function handleImport() {
    setImporting(true);
    await new Promise((r) => setTimeout(r, 1200));
    setImporting(false);
    toast.success("237 leads imported successfully");
    setStep(0);
  }

  return (
    <>
      <PageHeader
        title="Import Leads"
        description="Bulk import leads from CSV, spreadsheet, or paste."
      />
      <PageBody>
        {/* Stepper */}
        <div className="flex items-center gap-0">
          {STEPS.map((s, i) => (
            <React.Fragment key={s.label}>
              <button
                onClick={() => setStep(i)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  step === i
                    ? "bg-primary/10 text-primary"
                    : i < step
                      ? "text-emerald-400 hover:bg-muted/30"
                      : "text-muted-foreground hover:bg-muted/30",
                )}
              >
                <div
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold border shrink-0",
                    step === i
                      ? "bg-primary text-primary-foreground border-primary"
                      : i < step
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
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
            <div className="rounded-xl border-2 border-dashed border-muted-foreground/20 hover:border-primary/40 transition-colors p-12 flex flex-col items-center justify-center gap-4 bg-muted/10">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <CloudUpload className="h-7 w-7" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">
                  Drop your file here, or{" "}
                  <button
                    className="text-primary hover:underline"
                    onClick={() => toast.info("File picker (coming soon)")}
                  >
                    browse
                  </button>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  CSV, TSV, or paste rows directly
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={() => toast.info("File picker (coming soon)")}
              >
                <Upload className="h-4 w-4" /> Upload file
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  toast.success("Paste detected: 248 rows");
                  setTimeout(() => setStep(1), 400);
                }}
              >
                <ClipboardPaste className="h-4 w-4" /> Paste from clipboard
              </Button>
            </div>

            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => setStep(1)}
              >
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
                {SOURCE_FIELDS.map((sf) => (
                  <div
                    key={sf}
                    className="flex items-center gap-4 px-4 py-2.5 hover:bg-muted/10"
                  >
                    <div className="flex-1">
                      <span className="text-sm font-mono text-muted-foreground">
                        {sf}
                      </span>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                    <div className="flex-1">
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

            <div className="flex justify-between">
              <Button variant="outline" size="sm" onClick={() => setStep(0)}>
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
              <Button size="sm" onClick={() => setStep(2)}>
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
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: "Total rows", value: "248", color: "text-foreground" },
                  { label: "Duplicates detected", value: "11", hint: "matched on email", color: "text-amber-400" },
                  { label: "Will be created", value: "237", color: "text-emerald-400" },
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
                  { value: "skip", label: "Skip duplicates", desc: "Keep existing records, discard incoming duplicates." },
                  { value: "merge", label: "Merge duplicates", desc: "Update existing records with new data. Existing fields take priority." },
                  { value: "create", label: "Create anyway", desc: "Import all rows regardless. May create duplicate leads." },
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

            <div className="flex items-center gap-2 p-3 rounded-md bg-amber-500/5 border border-amber-500/20 text-xs text-amber-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>
                This action imports <strong>237</strong> new leads. Review your column mapping before proceeding.
              </span>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" size="sm" onClick={() => setStep(1)}>
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
              <Button size="sm" onClick={handleImport} disabled={importing}>
                {importing ? (
                  <>Importing…</>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Import 237 leads
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
