"use client";

import * as React from "react";
import {
  CheckCircle2,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import {
  emailVerificationLabel,
  resolveEmailVerificationStatus,
  shouldOfferEmailVerify,
} from "@/lib/email/email-verification-status";
import {
  emptyVerifySummary,
  formatVerifySummary,
  verifyLeadEmailsClient,
  type VerifyEmailApiResult,
  type VerifyEmailApiSummary,
} from "@/lib/integrations/millionverifier/verify-client";
import { cn } from "@/lib/utils";

type RowStatus = "pending" | "running" | "success" | "skipped" | "failed";

type LeadRow = {
  leadId: string;
  label: string;
  email?: string;
  status: RowStatus;
  detail?: string;
};

function leadLabel(lead: {
  contactName?: string;
  companyName?: string;
  id: string;
}): string {
  const name = lead.contactName?.trim();
  const company = lead.companyName?.trim();
  if (name && company) return `${name} · ${company}`;
  return name || company || lead.id;
}

function resultToRowPatch(result: VerifyEmailApiResult): {
  status: RowStatus;
  detail?: string;
  email?: string;
} {
  if (result.skipped) {
    return {
      status: "skipped",
      detail: result.error || "Skipped",
      email: result.email,
    };
  }
  if (result.error && !result.status) {
    return {
      status: "failed",
      detail: result.error,
      email: result.email,
    };
  }
  if (result.status) {
    return {
      status: result.status === "bounced" ? "failed" : "success",
      detail: emailVerificationLabel(result.status),
      email: result.email,
    };
  }
  return { status: "failed", detail: "No result", email: result.email };
}

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "destructive" | "warning" | "muted";
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-2.5 py-1.5",
        tone === "success" && "border-success/30 bg-success/10",
        tone === "destructive" && "border-destructive/30 bg-destructive/10",
        tone === "warning" && "border-warning/30 bg-warning/10",
        (!tone || tone === "muted") && "bg-muted/40",
      )}
    >
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function BulkVerifyEmailsDialog({
  open,
  onOpenChange,
  leadIds,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  onComplete?: () => void;
}) {
  const { isDemo, leads, getContactById } = useWorkspace();

  const [phase, setPhase] = React.useState<"running" | "done">("running");
  const [rows, setRows] = React.useState<LeadRow[]>([]);
  const [doneCount, setDoneCount] = React.useState(0);
  const [totalCount, setTotalCount] = React.useState(0);
  const [summary, setSummary] = React.useState<VerifyEmailApiSummary>(emptyVerifySummary);
  const [preflightNote, setPreflightNote] = React.useState<string | null>(null);
  const [cancelled, setCancelled] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const softCancelRef = React.useRef(false);
  const onCompleteRef = React.useRef(onComplete);
  const leadsRef = React.useRef(leads);
  const getContactByIdRef = React.useRef(getContactById);

  onCompleteRef.current = onComplete;
  leadsRef.current = leads;
  getContactByIdRef.current = getContactById;

  const leadIdsKey = leadIds.join("\0");

  React.useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }

    if (isDemo) {
      toast.info("Demo workspace", {
        description: "Email verification is disabled in sample data.",
      });
      onOpenChange(false);
      return;
    }

    const ids = leadIdsKey ? leadIdsKey.split("\0") : [];
    const readyIds: string[] = [];
    const initialRows: LeadRow[] = [];
    let alreadyVerified = 0;
    let noEmail = 0;
    let missing = 0;

    for (const id of ids) {
      const lead = leadsRef.current.find((l) => l.id === id);
      if (!lead) {
        missing += 1;
        continue;
      }
      const contact = getContactByIdRef.current(lead.contactId);
      const email =
        contact?.email?.trim() || lead.contactEmail?.trim() || "";
      if (!email) {
        noEmail += 1;
        continue;
      }
      const status = resolveEmailVerificationStatus(contact, lead);
      if (!shouldOfferEmailVerify(status)) {
        alreadyVerified += 1;
        continue;
      }
      readyIds.push(id);
      initialRows.push({
        leadId: id,
        label: leadLabel(lead),
        email,
        status: "pending",
      });
    }

    const notes: string[] = [];
    if (alreadyVerified) notes.push(`${alreadyVerified} already verified (skipped)`);
    if (noEmail) notes.push(`${noEmail} with no email (skipped)`);
    if (missing) notes.push(`${missing} not found`);
    const noteText = notes.length ? notes.join(" · ") : null;
    setPreflightNote(noteText);

    if (readyIds.length === 0) {
      setPhase("done");
      setRows([]);
      setDoneCount(0);
      setTotalCount(0);
      setSummary(emptyVerifySummary());
      setCancelled(false);
      toast.info("Nothing to verify", {
        description: noteText || "No unverified emails in selection.",
      });
      onOpenChange(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    softCancelRef.current = false;

    setPhase("running");
    setRows(initialRows);
    setDoneCount(0);
    setTotalCount(readyIds.length);
    setSummary(emptyVerifySummary());
    setCancelled(false);

    let active = true;

    void (async () => {
      const { summary: finalSummary, cancelled: wasCancelled } =
        await verifyLeadEmailsClient(readyIds, {
          signal: controller.signal,
          shouldCancel: () => softCancelRef.current,
          onProgress: (progress) => {
            if (!active) return;
            setDoneCount(progress.done);
            setTotalCount(progress.total);
            setSummary(progress.summary);

            setRows((prev) => {
              const next = [...prev];
              const byId = new Map(next.map((r, idx) => [r.leadId, idx]));
              for (const result of progress.lastChunkResults) {
                const idx = byId.get(result.leadId);
                if (idx === undefined) continue;
                const patch = resultToRowPatch(result);
                next[idx] = {
                  ...next[idx]!,
                  status: patch.status,
                  detail: patch.detail,
                  email: patch.email || next[idx]!.email,
                };
              }
              return next;
            });
          },
        });

      if (!active) return;

      setSummary(finalSummary);
      setDoneCount(finalSummary.total);
      setCancelled(Boolean(wasCancelled));
      setPhase("done");
      abortRef.current = null;

      if (wasCancelled) {
        toast.message("Verification stopped", {
          description: formatVerifySummary(finalSummary),
        });
      } else if (
        finalSummary.failed &&
        !finalSummary.verified &&
        !finalSummary.bounced &&
        !finalSummary.catchAll &&
        !finalSummary.notVerified
      ) {
        toast.error(formatVerifySummary(finalSummary) || "Email verification failed");
      } else {
        toast.success(formatVerifySummary(finalSummary), {
          description: noteText ?? undefined,
        });
      }
      onCompleteRef.current?.();
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [open, leadIdsKey, isDemo, onOpenChange]);

  const percent =
    totalCount > 0 ? Math.min(100, Math.round((doneCount / totalCount) * 100)) : 0;
  const remaining = Math.max(0, totalCount - doneCount);

  const handleOpenChange = (next: boolean) => {
    if (!next && phase === "running") {
      softCancelRef.current = true;
      abortRef.current?.abort();
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton={phase === "done"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            {phase === "running" ? "Verifying emails" : "Verification complete"}
          </DialogTitle>
          <DialogDescription>
            {phase === "running"
              ? `Checking ${totalCount} email${totalCount === 1 ? "" : "s"} with Million Verifier.`
              : cancelled
                ? "Stopped early. Completed results were saved."
                : "Results are saved on each prospect."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {preflightNote ? (
            <p className="text-xs text-muted-foreground">{preflightNote}</p>
          ) : null}

          {totalCount > 0 ? (
            <Progress value={percent} className="w-full">
              <ProgressLabel className="text-xs text-muted-foreground">
                {phase === "running"
                  ? `Done ${doneCount} · Remaining ${remaining}`
                  : `Processed ${doneCount} of ${totalCount}`}
              </ProgressLabel>
              <ProgressValue className="text-xs">
                {() => `${percent}%`}
              </ProgressValue>
            </Progress>
          ) : (
            <p className="text-sm text-muted-foreground">
              No unverified emails in this selection.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <StatPill label="Verified" value={summary.verified} tone="success" />
            <StatPill label="Invalid" value={summary.bounced} tone="destructive" />
            <StatPill label="Risky" value={summary.catchAll} tone="warning" />
            <StatPill label="Unknown" value={summary.notVerified} tone="muted" />
            <StatPill label="Failed" value={summary.failed} tone="destructive" />
          </div>

          {rows.length > 0 ? (
            <ul className="max-h-56 space-y-1.5 overflow-y-auto rounded-md border p-2">
              {rows.map((row) => (
                <li
                  key={row.leadId}
                  className="flex items-start gap-2 rounded px-1.5 py-1 text-xs"
                >
                  {row.status === "pending" || row.status === "running" ? (
                    <Loader2
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground",
                        row.status === "running" && "animate-spin text-primary",
                        row.status === "pending" && phase === "running" && "opacity-40",
                      )}
                    />
                  ) : row.status === "success" ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  ) : (
                    <XCircle
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0",
                        row.status === "skipped"
                          ? "text-muted-foreground"
                          : "text-destructive",
                      )}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{row.label}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {row.detail || row.email || "Waiting…"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {phase === "running" ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                softCancelRef.current = true;
              }}
            >
              Stop after current batch
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
          <span />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
