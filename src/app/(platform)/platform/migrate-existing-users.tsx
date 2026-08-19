"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Result = {
  total: number;
  migrated: number;
  skipped: number;
  failed: number;
  results: Array<{
    uid: string;
    email: string;
    action: "skipped" | "migrated" | "failed";
    organizationId?: string;
    error?: string;
  }>;
};

export function MigrateExistingUsersButton() {
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<Result | null>(null);
  const [open, setOpen] = React.useState(false);

  async function run() {
    setOpen(false);
    setRunning(true);
    try {
      const res = await fetch("/api/platform/migrate-existing-users", {
        method: "POST",
      });
      const data = (await res.json()) as Result | { error: string };
      if (!res.ok) throw new Error("error" in data ? data.error : "Failed");
      setResult(data as Result);
      toast.success(
        `Migrated ${(data as Result).migrated}, skipped ${(data as Result).skipped}, failed ${(data as Result).failed}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <Button size="sm" disabled={running} onClick={() => setOpen(true)}>
          {running && <Loader2 className="h-4 w-4 animate-spin" />}
          Run migration
        </Button>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run legacy user migration?</AlertDialogTitle>
            <AlertDialogDescription>
              Safe to re-run. Users who already have an organization are skipped. Creates a personal
              workspace for each legacy user without a tenant.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run()}>Run migration</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {result && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
          <div className="font-medium">
            Total {result.total} · migrated {result.migrated} · skipped {result.skipped} · failed{" "}
            {result.failed}
          </div>
          <div className="max-h-48 space-y-1 overflow-auto font-mono">
            {result.results.map((r) => (
              <div key={r.uid} className="flex gap-2">
                <span
                  className={
                    r.action === "migrated"
                      ? "text-success"
                      : r.action === "failed"
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }
                >
                  [{r.action}]
                </span>
                <span>{r.email || r.uid}</span>
                {r.organizationId && (
                  <span className="text-muted-foreground">→ {r.organizationId}</span>
                )}
                {r.error && <span className="text-destructive">{r.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
