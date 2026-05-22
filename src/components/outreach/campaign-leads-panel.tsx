"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { INSTANTLY_MERGE_VARIABLES } from "@/lib/integrations/instantly/lead-mapper";
import { parseInstantlyId } from "@/lib/integrations/instantly/refs";
import { pushLeadsToCampaign } from "@/lib/outreach/push-leads";
import type { Lead } from "@/lib/types";
import { cn } from "@/lib/utils";

export function CampaignLeadsPanel({
  campaignId,
  campaignLeads,
  externalRef,
  instantlyId,
  connected,
  isDemo,
}: {
  campaignId: string;
  campaignLeads: Lead[];
  externalRef?: string;
  instantlyId?: string;
  connected: boolean;
  isDemo: boolean;
}) {
  const { leads, patchLead } = useWorkspace();
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [pushing, setPushing] = React.useState(false);
  const [varsOpen, setVarsOpen] = React.useState(false);

  const linked = Boolean(parseInstantlyId(externalRef, instantlyId));
  const canPushApi = connected && linked && !isDemo;

  const enrolledIds = React.useMemo(
    () => new Set(campaignLeads.map((l) => l.id)),
    [campaignLeads],
  );

  const eligible = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (l.doNotContact) return false;
      if (!l.contactEmail?.trim()) return false;
      if (!q) return true;
      const hay = [l.contactName, l.companyName, l.contactEmail, l.contactTitle]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [leads, search]);

  const selectedIds = React.useMemo(
    () => Object.keys(selected).filter((id) => selected[id] && !enrolledIds.has(id)),
    [selected, enrolledIds],
  );

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => ({ ...prev, [id]: checked }));
  }

  function toggleAll(checked: boolean) {
    const next: Record<string, boolean> = { ...selected };
    for (const l of eligible) {
      if (enrolledIds.has(l.id)) continue;
      next[l.id] = checked;
    }
    setSelected(next);
  }

  async function addSelected() {
    if (selectedIds.length === 0) return;
    setPushing(true);
    try {
      if (isDemo || !canPushApi) {
        for (const id of selectedIds) {
          patchLead(id, {
            campaignId,
            pushToInstantly: "pushed",
            channel: "cold_email",
          });
        }
        await pushLeadsToCampaign(campaignId, selectedIds, {
          isDemo: true,
        });
        setSelected({});
        return;
      }

      const result = await pushLeadsToCampaign(campaignId, selectedIds);
      if (result.ok) setSelected({});
    } finally {
      setPushing(false);
    }
  }

  const allSelectable = eligible.filter((l) => !enrolledIds.has(l.id));
  const allSelected =
    allSelectable.length > 0 && allSelectable.every((l) => selected[l.id]);

  return (
    <div className="space-y-6 max-w-4xl">
      <Collapsible open={varsOpen} onOpenChange={setVarsOpen}>
        <CollapsibleTrigger
          className="inline-flex h-8 items-center rounded-md px-2 text-xs text-muted-foreground hover:bg-muted"
        >
          {varsOpen ? "Hide" : "Show"} merge variables for Sequence emails
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 rounded-md border bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground mb-2">
            Use these in the <strong>Sequence</strong> tab as{" "}
            <code className="rounded bg-muted px-1">{`{{token}}`}</code> (snake_case). Values are
            filled from each lead when you add them below.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {INSTANTLY_MERGE_VARIABLES.map((v) => (
              <Badge key={v.token} variant="outline" className="font-mono text-[10px] font-normal">
                {`{{${v.token}}}`}
              </Badge>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Enrolled in this campaign ({campaignLeads.length})</h3>
        {campaignLeads.length === 0 ? (
          <p className="text-sm text-muted-foreground">No leads in this campaign yet. Add leads below.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {campaignLeads.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <Link href={`/leads/${l.id}`} className="font-medium text-primary hover:underline">
                  {l.contactName}
                </Link>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">{l.contactEmail}</span>
                  {l.pushToInstantly === "pushed" && (
                    <Badge variant="outline" className="text-[10px]">
                      In Instantly
                    </Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Add leads from CRM</h3>
          {!canPushApi && !isDemo && (
            <p className="text-xs text-warning">
              Connect Instantly and link this campaign to push leads with variables.
            </p>
          )}
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name, company, email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={pushing || selectedIds.length === 0 || (!canPushApi && !isDemo)}
            onClick={() => void addSelected()}
          >
            {pushing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <UserPlus className="h-3.5 w-3.5" />
            )}
            Add to campaign
            {selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
          </Button>
          {selectedIds.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setSelected({})}>
              Clear selection
            </Button>
          )}
        </div>

        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(c) => toggleAll(Boolean(c))}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Email</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {eligible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                    No leads with an email match your search.
                  </TableCell>
                </TableRow>
              ) : (
                eligible.slice(0, 100).map((l) => {
                  const enrolled = enrolledIds.has(l.id);
                  return (
                    <TableRow
                      key={l.id}
                      className={cn(enrolled && "opacity-50")}
                    >
                      <TableCell>
                        <Checkbox
                          checked={enrolled || Boolean(selected[l.id])}
                          disabled={enrolled}
                          onCheckedChange={(c) => toggle(l.id, Boolean(c))}
                          aria-label={`Select ${l.contactName}`}
                        />
                      </TableCell>
                      <TableCell className="text-sm font-medium">{l.contactName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{l.companyName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {l.contactEmail}
                        {enrolled && (
                          <span className="ml-2 text-[10px] text-muted-foreground">(enrolled)</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        {eligible.length > 100 && (
          <p className="text-xs text-muted-foreground">Showing first 100 matches. Refine search to find others.</p>
        )}
      </section>
    </div>
  );
}
