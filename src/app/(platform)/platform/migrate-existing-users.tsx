"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

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

  async function run() {
    if (!confirm("Run user migration? Safe to re-run; users with an org are skipped.")) return;
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
      <Button size="sm" onClick={run} disabled={running}>
        {running && <Loader2 className="h-4 w-4 animate-spin" />}
        Run migration
      </Button>
      {result && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
          <div className="font-medium">
            Total {result.total} · migrated {result.migrated} · skipped{" "}
            {result.skipped} · failed {result.failed}
          </div>
          <div className="max-h-48 overflow-auto space-y-1 font-mono">
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
