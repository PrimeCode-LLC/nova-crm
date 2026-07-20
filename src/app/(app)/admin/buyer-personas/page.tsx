"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import {
  newProspectingEntityId,
  useProspectingStrategyData,
} from "@/lib/hooks/use-prospecting-strategy-data";
import type { BuyerPersona, BuyerPersonaTitle } from "@/lib/prospecting-strategy/types";

function parseLines(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseTitles(raw: string, kind: BuyerPersonaTitle["kind"]): BuyerPersonaTitle[] {
  return parseLines(raw).map((title) => ({ title, kind }));
}

function titlesToLines(titles: BuyerPersonaTitle[], kind: BuyerPersonaTitle["kind"]): string {
  return titles.filter((t) => t.kind === kind).map((t) => t.title).join("\n");
}

type PersonaDraft = {
  name: string;
  description: string;
  department: string;
  seniority: string;
  approvedTitles: string;
  similarTitles: string;
  excludedTitles: string;
  industries: string;
  countries: string;
  painPoints: string;
  buyingTriggers: string;
  relevantServices: string;
  recommendedAngle: string;
  valueProposition: string;
  personalizationNotes: string;
  goodExamples: string;
  badExamples: string;
  priority: string;
  active: boolean;
};

const emptyDraft = (): PersonaDraft => ({
  name: "",
  description: "",
  department: "",
  seniority: "",
  approvedTitles: "",
  similarTitles: "",
  excludedTitles: "",
  industries: "",
  countries: "",
  painPoints: "",
  buyingTriggers: "",
  relevantServices: "",
  recommendedAngle: "",
  valueProposition: "",
  personalizationNotes: "",
  goodExamples: "",
  badExamples: "",
  priority: "50",
  active: true,
});

function personaToDraft(p: BuyerPersona): PersonaDraft {
  return {
    name: p.name,
    description: p.description ?? "",
    department: p.department ?? "",
    seniority: p.seniority ?? "",
    approvedTitles: titlesToLines(p.titles, "approved"),
    similarTitles: titlesToLines(p.titles, "similar"),
    excludedTitles: titlesToLines(p.titles, "excluded"),
    industries: p.industries.join("\n"),
    countries: p.countries.join("\n"),
    painPoints: p.painPoints.join("\n"),
    buyingTriggers: p.buyingTriggers.join("\n"),
    relevantServices: p.relevantServices.join("\n"),
    recommendedAngle: p.recommendedAngle ?? "",
    valueProposition: p.valueProposition ?? "",
    personalizationNotes: p.personalizationNotes ?? "",
    goodExamples: p.goodExamples ?? "",
    badExamples: p.badExamples ?? "",
    priority: String(p.priority),
    active: p.active,
  };
}

function draftToPersonaFields(draft: PersonaDraft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    department: draft.department.trim() || undefined,
    seniority: draft.seniority.trim() || undefined,
    titles: [
      ...parseTitles(draft.approvedTitles, "approved"),
      ...parseTitles(draft.similarTitles, "similar"),
      ...parseTitles(draft.excludedTitles, "excluded"),
    ],
    industries: parseLines(draft.industries),
    countries: parseLines(draft.countries),
    painPoints: parseLines(draft.painPoints),
    buyingTriggers: parseLines(draft.buyingTriggers),
    relevantServices: parseLines(draft.relevantServices),
    recommendedAngle: draft.recommendedAngle.trim() || undefined,
    valueProposition: draft.valueProposition.trim() || undefined,
    personalizationNotes: draft.personalizationNotes.trim() || undefined,
    goodExamples: draft.goodExamples.trim() || undefined,
    badExamples: draft.badExamples.trim() || undefined,
    priority: Number(draft.priority) || 0,
    active: draft.active,
  };
}

export default function AdminBuyerPersonasPage() {
  const ws = useWorkspace();
  const data = useProspectingStrategyData();
  const [open, setOpen] = React.useState(false);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<PersonaDraft>(emptyDraft);
  const [saving, setSaving] = React.useState(false);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");

  const sorted = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...data.personas]
      .filter((p) => {
        if (!needle) return true;
        return (
          p.name.toLowerCase().includes(needle) ||
          (p.department ?? "").toLowerCase().includes(needle) ||
          p.titles.some((t) => t.title.toLowerCase().includes(needle))
        );
      })
      .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  }, [data.personas, q]);

  const strategyCountByPersona = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const s of data.strategies) {
      for (const pid of s.personaIds) {
        map.set(pid, (map.get(pid) ?? 0) + 1);
      }
    }
    return map;
  }, [data.strategies]);

  const openCreate = () => {
    setEditId(null);
    setDraft(emptyDraft());
    setOpen(true);
  };

  const openEdit = (p: BuyerPersona) => {
    setEditId(p.id);
    setDraft(personaToDraft(p));
    setOpen(true);
  };

  const submit = async () => {
    const fields = draftToPersonaFields(draft);
    if (!fields.name) {
      toast.error("Enter a persona name.");
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      if (editId) {
        await data.updatePersona(editId, { ...fields, updatedAt: now });
        toast.success("Persona updated");
      } else {
        const persona: BuyerPersona = {
          id: newProspectingEntityId("bp"),
          organizationId: data.organizationId,
          ...fields,
          responsibilities: [],
          businessGoals: [],
          objections: [],
          relevantSignalIds: [],
          createdBy: ws.currentUserId,
          createdAt: now,
          updatedAt: now,
        };
        await data.addPersona(persona);
        toast.success("Persona created");
      }
      setOpen(false);
    } catch (e) {
      toast.error("Could not save persona", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Buyer personas"
        description="ICP decision-maker profiles used by prospecting strategies. Separate from outreach Profiles."
        actions={
          <Button size="sm" type="button" onClick={openCreate}>
            <Plus className="size-4" />
            New persona
          </Button>
        }
      />
      <PageBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="max-w-xs"
            placeholder="Search personas…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {data.loading ? (
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" /> Loading
            </span>
          ) : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Persona library</CardTitle>
            <CardDescription>
              Attach personas to strategies so researchers know who to find and how to message them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sorted.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No personas yet. Create one, or seed the master pack from Strategies.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {sorted.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-3 py-3 text-sm"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium truncate">{p.name}</span>
                        {!p.active ? <Badge variant="secondary">Inactive</Badge> : null}
                        <Badge variant="outline">P{p.priority}</Badge>
                        <Badge variant="outline">
                          {strategyCountByPersona.get(p.id) ?? 0} strategies
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {p.description ||
                          p.titles
                            .filter((t) => t.kind === "approved")
                            .slice(0, 4)
                            .map((t) => t.title)
                            .join(" · ") ||
                          "No description"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(p)}>
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setDeleteId(p.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </PageBody>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit persona" : "New buyer persona"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1.5">
              <Label>Name</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="e.g. Supply Chain Executive"
              />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label>Description</Label>
              <Textarea
                rows={2}
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Who this buyer is and what they own — e.g. Operational buyer owning inventory flow and supply-chain tech."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Input
                value={draft.department}
                onChange={(e) => setDraft((d) => ({ ...d, department: e.target.value }))}
                placeholder="e.g. Supply Chain, Engineering, IT"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Seniority</Label>
              <Input
                value={draft.seniority}
                onChange={(e) => setDraft((d) => ({ ...d, seniority: e.target.value }))}
                placeholder="e.g. C-level / VP / Director"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Approved titles (one per line)</Label>
              <Textarea
                rows={3}
                value={draft.approvedTitles}
                onChange={(e) => setDraft((d) => ({ ...d, approvedTitles: e.target.value }))}
                placeholder={"VP Supply Chain\nDirector of Supply Chain\nChief Supply Chain Officer"}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Similar titles</Label>
              <p className="text-xs text-muted-foreground">
                Acceptable alternatives — one per line.
              </p>
              <Textarea
                rows={3}
                value={draft.similarTitles}
                onChange={(e) => setDraft((d) => ({ ...d, similarTitles: e.target.value }))}
                placeholder={"Head of Logistics\nWarehouse Operations Manager"}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Excluded titles</Label>
              <p className="text-xs text-muted-foreground">
                Do not outreach these — one per line.
              </p>
              <Textarea
                rows={2}
                value={draft.excludedTitles}
                onChange={(e) => setDraft((d) => ({ ...d, excludedTitles: e.target.value }))}
                placeholder={"Recruiter\nSales Director\nSoftware Engineer"}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Industries</Label>
              <p className="text-xs text-muted-foreground">One per line.</p>
              <Textarea
                rows={2}
                value={draft.industries}
                onChange={(e) => setDraft((d) => ({ ...d, industries: e.target.value }))}
                placeholder={"Logistics\nWarehousing\nManufacturing"}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Pain points</Label>
              <p className="text-xs text-muted-foreground">One per line.</p>
              <Textarea
                rows={3}
                value={draft.painPoints}
                onChange={(e) => setDraft((d) => ({ ...d, painPoints: e.target.value }))}
                placeholder={"Inventory inaccuracies\nLack of visibility\nFragmented systems"}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Buying triggers</Label>
              <p className="text-xs text-muted-foreground">
                Events that open a conversation — one per line.
              </p>
              <Textarea
                rows={3}
                value={draft.buyingTriggers}
                onChange={(e) => setDraft((d) => ({ ...d, buyingTriggers: e.target.value }))}
                placeholder={"RFID rollout\nNew distribution center\nWMS replacement"}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Relevant services</Label>
              <p className="text-xs text-muted-foreground">
                Stellix Soft offerings this persona buys — one per line.
              </p>
              <Textarea
                rows={2}
                value={draft.relevantServices}
                onChange={(e) => setDraft((d) => ({ ...d, relevantServices: e.target.value }))}
                placeholder={"RFID and asset tracking\nERP and WMS integrations\nReal-time dashboards"}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Countries</Label>
              <p className="text-xs text-muted-foreground">One per line.</p>
              <Textarea
                rows={2}
                value={draft.countries}
                onChange={(e) => setDraft((d) => ({ ...d, countries: e.target.value }))}
                placeholder={"United States\nCanada"}
              />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label>Recommended outreach angle</Label>
              <Textarea
                rows={2}
                value={draft.recommendedAngle}
                onChange={(e) => setDraft((d) => ({ ...d, recommendedAngle: e.target.value }))}
                placeholder="e.g. Lead with the software and dashboards around their supply-chain visibility initiative."
              />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label>Value proposition</Label>
              <Textarea
                rows={2}
                value={draft.valueProposition}
                onChange={(e) => setDraft((d) => ({ ...d, valueProposition: e.target.value }))}
                placeholder="e.g. Give supply-chain leaders real-time inventory visibility through RFID/IoT, dashboards, and ERP/WMS integrations."
              />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label>Personalization notes</Label>
              <p className="text-xs text-muted-foreground">
                Guidance researchers follow when writing the note (trigger → impact → service → angle).
              </p>
              <Textarea
                rows={3}
                value={draft.personalizationNotes}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, personalizationNotes: e.target.value }))
                }
                placeholder={`Trigger: what recently happened?\nLikely impact: what need does it create?\nRelevant service: which capability addresses it?\nAngle: what should the message lead with?`}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Good examples</Label>
              <Textarea
                rows={2}
                value={draft.goodExamples}
                onChange={(e) => setDraft((d) => ({ ...d, goodExamples: e.target.value }))}
                placeholder="e.g. A 3PL announcing a new DC + hiring a WMS admin — Hot when VP Supply Chain is attached."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Bad examples</Label>
              <Textarea
                rows={2}
                value={draft.badExamples}
                onChange={(e) => setDraft((d) => ({ ...d, badExamples: e.target.value }))}
                placeholder="e.g. SAP present with no project, pain, or hiring — technology alone is not intent."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Input
                type="number"
                value={draft.priority}
                onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))}
                placeholder="Higher = preferred (e.g. 100)"
              />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch
                checked={draft.active}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, active: v }))}
              />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={saving} onClick={() => void submit()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteId)} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete persona?</AlertDialogTitle>
            <AlertDialogDescription>
              Strategies that reference this persona will keep the id until you remove it from them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleteId) return;
                void data
                  .deletePersona(deleteId)
                  .then(() => toast.success("Persona deleted"))
                  .catch((e) =>
                    toast.error("Delete failed", {
                      description: e instanceof Error ? e.message : String(e),
                    }),
                  );
                setDeleteId(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
