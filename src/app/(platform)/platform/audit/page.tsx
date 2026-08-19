"use client";

import * as React from "react";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { PlatformAuditRecord } from "@/lib/types";
import { fmtRelative } from "@/lib/format";
import { toast } from "sonner";

const EVENT_LABELS: Record<string, string> = {
  "org.created": "Org created",
  "org.updated": "Org updated",
  "org.suspended": "Org suspended",
  "org.archived": "Org archived",
  "org.restored": "Org restored",
  "admin.granted": "Admin granted",
  "admin.revoked": "Admin revoked",
  "admin.role_changed": "Admin role changed",
  "member.disabled": "Member disabled",
  "member.enabled": "Member enabled",
  "migration.run": "Migration run",
  "bulk.action": "Bulk action",
};

export default function PlatformAuditPage() {
  const [entries, setEntries] = React.useState<PlatformAuditRecord[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/platform/audit?limit=200");
        const data = (await res.json()) as { entries?: PlatformAuditRecord[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? res.statusText);
        if (!cancelled) setEntries(data.entries ?? []);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/platform" className="text-xs text-muted-foreground hover:text-foreground">
          ← Platform overview
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ClipboardList className="h-6 w-6" />
          Audit log
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Append-only record of platform operator actions. Tenant-scoped CRM audit logs remain inside
          each workspace.
        </p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <p className="text-sm font-medium">No platform audit entries yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Actions like creating orgs, granting admins, and bulk cleanup will appear here.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Actor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {fmtRelative(e.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {EVENT_LABELS[e.event] ?? e.event}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-md text-sm">
                    {e.summary}
                    {e.targetOrgId && (
                      <Link
                        href={`/platform/organizations/${e.targetOrgId}`}
                        className="mt-0.5 block truncate font-mono text-xs text-primary hover:underline"
                      >
                        {e.targetOrgId}
                      </Link>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {e.actorEmail ?? e.actorUid}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
