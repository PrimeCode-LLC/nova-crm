"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { INTENT_PLAYBOOK_TEMPLATES } from "@/lib/intent/playbook-templates";
import { parseIntentPlaybook } from "@/lib/intent/parse-playbook";
import type {
  IntentPlaybook,
  IntentPlaybookTemplateId,
  IntentSignalCategory,
  IntentSignalDefinition,
} from "@/lib/intent/types";
import { Badge } from "@/components/ui/badge";

const CATEGORY_OPTIONS: { value: IntentSignalCategory; label: string }[] = [
  { value: "hiring", label: "Hiring" },
  { value: "legacy_stack", label: "Legacy stack" },
  { value: "digital_transformation", label: "Digital transformation" },
  { value: "funding", label: "Funding" },
  { value: "expansion", label: "Expansion" },
  { value: "supply_chain", label: "Supply chain" },
  { value: "technology", label: "Technology" },
  { value: "operational_pain", label: "Operational pain" },
  { value: "compliance", label: "Compliance" },
  { value: "website", label: "Website" },
  { value: "custom", label: "Custom" },
];

function newSignalId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `sig-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `sig-${Date.now()}`;
}

export function IntentPlaybookAdminClient({
  initialPlaybook,
}: {
  initialPlaybook: IntentPlaybook;
}) {
  const ws = useWorkspace();
  const [playbook, setPlaybook] = React.useState<IntentPlaybook>(initialPlaybook);
  const [saving, setSaving] = React.useState(false);
  const [applying, setApplying] = React.useState<string | null>(null);

  const syncLocal = (next: IntentPlaybook) => {
    setPlaybook(next);
    ws.setIntentPlaybook(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/org/intent-playbook", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: playbook.templateId,
          name: playbook.name,
          outreachThreshold: playbook.outreachThreshold,
          tempBands: playbook.tempBands,
          autoTemperature: playbook.autoTemperature,
          signals: playbook.signals,
          engagement: playbook.engagement,
        }),
      });
      const text = await res.text();
      let data: { error?: unknown; playbook?: IntentPlaybook } = {};
      if (text) {
        try {
          data = JSON.parse(text) as { error?: unknown; playbook?: IntentPlaybook };
        } catch {
          toast.error("Could not save playbook", {
            description: text.slice(0, 160) || `Server error (${res.status})`,
          });
          return;
        }
      }
      if (!res.ok) {
        toast.error("Could not save playbook", {
          description:
            typeof data.error === "string"
              ? data.error
              : data.error
                ? JSON.stringify(data.error).slice(0, 200)
                : `Server error (${res.status})`,
        });
        return;
      }
      if (data.playbook) {
        const parsed = parseIntentPlaybook(data.playbook);
        syncLocal(parsed);
      }
      toast.success("Intent playbook saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const applyTemplate = async (templateId: IntentPlaybookTemplateId) => {
    setApplying(templateId);
    try {
      const res = await fetch("/api/org/intent-playbook", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applyTemplate: true, templateId }),
      });
      const text = await res.text();
      let data: { error?: string; playbook?: IntentPlaybook } = {};
      if (text) {
        try {
          data = JSON.parse(text) as { error?: string; playbook?: IntentPlaybook };
        } catch {
          toast.error("Could not apply template", {
            description: text.slice(0, 160) || `Server error (${res.status})`,
          });
          return;
        }
      }
      if (!res.ok) {
        toast.error(data.error || `Could not apply template (${res.status})`);
        return;
      }
      if (data.playbook) {
        syncLocal(parseIntentPlaybook(data.playbook));
        toast.success(`Applied “${INTENT_PLAYBOOK_TEMPLATES[templateId].name}”`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Apply failed");
    } finally {
      setApplying(null);
    }
  };

  const updateSignal = (id: string, patch: Partial<IntentSignalDefinition>) => {
    setPlaybook((p) => ({
      ...p,
      signals: p.signals.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  };

  const removeSignal = (id: string) => {
    setPlaybook((p) => ({ ...p, signals: p.signals.filter((s) => s.id !== id) }));
  };

  const addSignal = () => {
    const signal: IntentSignalDefinition = {
      id: newSignalId(),
      label: "New signal",
      category: "custom",
      points: 10,
      enabled: true,
      keywords: [],
    };
    setPlaybook((p) => ({ ...p, signals: [...p.signals, signal] }));
  };

  return (
    <>
      <PageHeader
        title="Intent playbook"
        description="Configure how prospect Quality Score is calculated. Soft-gates outreach below the threshold — never hard-blocks."
        actions={
          <Button size="sm" disabled={saving || ws.isDemo} onClick={() => void save()}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save playbook
          </Button>
        }
      />
      <PageBody className="max-w-4xl gap-6 [&>*]:shrink-0">
        {ws.isDemo ? (
          <p className="text-sm text-muted-foreground rounded-lg border bg-muted/40 px-3 py-2">
            Demo mode uses the default modernization playbook locally. Switch to live to persist org
            settings.
          </p>
        ) : null}

        <Card className="shrink-0">
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-base">Templates</CardTitle>
            <CardDescription>
              Start from a ready-made ICP playbook, then tune signals for your team.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 pt-4 sm:grid-cols-2">
            {Object.values(INTENT_PLAYBOOK_TEMPLATES).map((t) => (
              <div key={t.id} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                  </div>
                  {playbook.templateId === t.id ? (
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      Active
                    </Badge>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={Boolean(applying) || ws.isDemo}
                  onClick={() => void applyTemplate(t.id)}
                >
                  {applying === t.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Apply
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="shrink-0">
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-base">Scoring rules</CardTitle>
            <CardDescription>
              Threshold {playbook.outreachThreshold}+ = ready for outreach. Temp maps Cold / Warm /
              Hot from the score.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pb-name">Playbook name</Label>
                <Input
                  id="pb-name"
                  value={playbook.name}
                  onChange={(e) => setPlaybook((p) => ({ ...p, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pb-threshold">Outreach threshold (0–100)</Label>
                <Input
                  id="pb-threshold"
                  type="number"
                  min={0}
                  max={100}
                  value={playbook.outreachThreshold}
                  onChange={(e) =>
                    setPlaybook((p) => ({
                      ...p,
                      outreachThreshold: Number(e.target.value) || 0,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pb-warm">Warm from score</Label>
                <Input
                  id="pb-warm"
                  type="number"
                  min={0}
                  max={100}
                  value={playbook.tempBands.warmMin}
                  onChange={(e) =>
                    setPlaybook((p) => ({
                      ...p,
                      tempBands: { ...p.tempBands, warmMin: Number(e.target.value) || 0 },
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pb-hot">Hot from score</Label>
                <Input
                  id="pb-hot"
                  type="number"
                  min={0}
                  max={100}
                  value={playbook.tempBands.hotMin}
                  onChange={(e) =>
                    setPlaybook((p) => ({
                      ...p,
                      tempBands: { ...p.tempBands, hotMin: Number(e.target.value) || 0 },
                    }))
                  }
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
              <div>
                <p className="text-sm font-medium">Auto-update temperature</p>
                <p className="text-xs text-muted-foreground">
                  Derive Cold/Warm/Hot from Quality Score (skipped when temperature is locked).
                </p>
              </div>
              <Switch
                checked={playbook.autoTemperature}
                onCheckedChange={(v) => setPlaybook((p) => ({ ...p, autoTemperature: v }))}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Reply boost</Label>
                <Input
                  type="number"
                  min={0}
                  max={50}
                  value={playbook.engagement.reply}
                  onChange={(e) =>
                    setPlaybook((p) => ({
                      ...p,
                      engagement: { ...p.engagement, reply: Number(e.target.value) || 0 },
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Multi-touch boost</Label>
                <Input
                  type="number"
                  min={0}
                  max={50}
                  value={playbook.engagement.multiTouch}
                  onChange={(e) =>
                    setPlaybook((p) => ({
                      ...p,
                      engagement: { ...p.engagement, multiTouch: Number(e.target.value) || 0 },
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Touches required</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={playbook.engagement.multiTouchMin}
                  onChange={(e) =>
                    setPlaybook((p) => ({
                      ...p,
                      engagement: {
                        ...p.engagement,
                        multiTouchMin: Number(e.target.value) || 1,
                      },
                    }))
                  }
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Signals ({playbook.signals.length})</h2>
          <Button type="button" variant="outline" size="sm" onClick={addSignal}>
            <Plus className="h-3.5 w-3.5" /> Add signal
          </Button>
        </div>

        <div className="space-y-3">
          {playbook.signals.map((signal) => (
            <Card key={signal.id}>
              <CardContent className="pt-4 space-y-3">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex-1 min-w-[140px] space-y-1">
                    <Label className="text-xs">Label</Label>
                    <Input
                      value={signal.label}
                      onChange={(e) => updateSignal(signal.id, { label: e.target.value })}
                    />
                  </div>
                  <div className="w-40 space-y-1">
                    <Label className="text-xs">Category</Label>
                    <Select
                      value={signal.category}
                      onValueChange={(v) => {
                        if (v) updateSignal(signal.id, { category: v as IntentSignalCategory });
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Category">
                          {CATEGORY_OPTIONS.find((c) => c.value === signal.category)?.label ??
                            signal.category}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORY_OPTIONS.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-24 space-y-1">
                    <Label className="text-xs">Points</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={signal.points}
                      onChange={(e) =>
                        updateSignal(signal.id, { points: Number(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-5">
                    <Switch
                      checked={signal.enabled}
                      onCheckedChange={(v) => updateSignal(signal.id, { enabled: v })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeSignal(signal.id)}
                      aria-label="Remove signal"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Keywords (comma-separated)</Label>
                  <Textarea
                    rows={2}
                    value={signal.keywords.join(", ")}
                    onChange={(e) =>
                      updateSignal(signal.id, {
                        keywords: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="hiring, .net developer, series a…"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">CRM labels (optional)</Label>
                    <Input
                      value={(signal.labelNames ?? []).join(", ")}
                      onChange={(e) =>
                        updateSignal(signal.id, {
                          labelNames: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder=".Net, RFID"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Match workspace labels on the prospect (Admin → Labels).
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Industries (optional)</Label>
                    <Input
                      value={(signal.industries ?? []).join(", ")}
                      onChange={(e) =>
                        updateSignal(signal.id, {
                          industries: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="healthcare, manufacturing"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Match company industry text. Leave empty to skip.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {!playbook.signals.length ? (
            <p className="text-sm text-muted-foreground">No signals — add one or apply a template.</p>
          ) : null}
        </div>
      </PageBody>
    </>
  );
}
