"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

type ConfigOption = { id: string; label: string };

type ExperimentRow = {
  id: string;
  name: string;
  hypothesis: string;
  status: string;
  stage: number;
  minPerArm: number;
  assignmentCount: number;
  remainingPerArm: number;
  arms: Array<{ id: string; label: string; configId: string; assigned: number; isControl: boolean }>;
};

export function ExperimentsTab(props: { configs: ConfigOption[] }) {
  const { configs } = props;
  const [experiments, setExperiments] = React.useState<ExperimentRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [name, setName] = React.useState("");
  const [hypothesis, setHypothesis] = React.useState("");
  const [controlConfigId, setControlConfigId] = React.useState("");
  const [variantConfigId, setVariantConfigId] = React.useState("");
  const [leadIdsText, setLeadIdsText] = React.useState("");
  const [stage, setStage] = React.useState<1 | 2>(1);
  const [busy, setBusy] = React.useState(false);
  const [skipAaGate, setSkipAaGate] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/experiments");
      const data = await res.json();
      if (res.ok) setExperiments(data.experiments ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!controlConfigId && configs[0]) setControlConfigId(configs[0].id);
    if (!variantConfigId && configs[1]) setVariantConfigId(configs[1].id);
  }, [configs, controlConfigId, variantConfigId]);

  async function start() {
    const leadIds = leadIdsText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!name.trim() || !hypothesis.trim() || !controlConfigId || !variantConfigId) {
      toast.error("Name, hypothesis, and both configs are required");
      return;
    }
    if (controlConfigId === variantConfigId) {
      toast.error("Control and variant must differ (use A/A script for same-config tests)");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          hypothesis: hypothesis.trim(),
          stage,
          controlConfigId,
          variantConfigId,
          leadIds,
          skipAaGate: skipAaGate || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Start failed");
        return;
      }
      toast.success(`Experiment started · ${data.assigned} assigned`);
      if (typeof data.experimentId === "string") {
        try {
          sessionStorage.setItem("outreachExperimentId", data.experimentId);
        } catch {
          /* ignore */
        }
      }
      setName("");
      setHypothesis("");
      setLeadIdsText("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function stop(id: string) {
    const res = await fetch(`/api/experiments/${id}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "stopped_from_lab_ui" }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(typeof data.error === "string" ? data.error : "Stop failed");
      return;
    }
    toast.success("Experiment stopped");
    await load();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Start experiment</CardTitle>
          <CardDescription>
            Stage 1 needs ≥600 leads/arm; stage 2 ≥1900. Paste lead IDs (comma or newline).
            Assignments are stored — wire into generate/schedule is still Slice C.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Stage</Label>
              <select
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                value={stage}
                onChange={(e) => setStage(Number(e.target.value) as 1 | 2)}
              >
                <option value={1}>1 · 600/arm</option>
                <option value={2}>2 · 1900/arm</option>
              </select>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Hypothesis</Label>
              <Input value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Control config</Label>
              <select
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                value={controlConfigId}
                onChange={(e) => setControlConfigId(e.target.value)}
              >
                {configs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Variant config</Label>
              <select
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                value={variantConfigId}
                onChange={(e) => setVariantConfigId(e.target.value)}
              >
                {configs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Lead IDs</Label>
              <Textarea
                className="min-h-24 font-mono text-xs"
                value={leadIdsText}
                onChange={(e) => setLeadIdsText(e.target.value)}
                placeholder="lead-abc&#10;lead-def"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="skip-aa"
              checked={skipAaGate}
              onCheckedChange={(v) => setSkipAaGate(v === true)}
            />
            <Label htmlFor="skip-aa" className="text-sm font-normal">
              Skip A/A gate (override — only after reviewing assignment risk)
            </Label>
          </div>
          <Button size="sm" disabled={busy || configs.length < 2} onClick={() => void start()}>
            {busy ? "Starting…" : "Start experiment"}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {loading && <p className="text-sm text-muted-foreground">Loading experiments…</p>}
        {!loading && experiments.length === 0 && (
          <p className="text-sm text-muted-foreground">No experiments yet.</p>
        )}
        {experiments.map((exp) => (
          <Card key={exp.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm">{exp.name}</CardTitle>
                <Badge variant="secondary">{exp.status}</Badge>
              </div>
              <CardDescription>
                Stage {exp.stage} · {exp.assignmentCount} assigned ·{" "}
                {exp.remainingPerArm > 0
                  ? `${exp.remainingPerArm} more needed per arm`
                  : "min sample met"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <p className="text-muted-foreground">{exp.hypothesis}</p>
              <div className="flex flex-wrap gap-2">
                {exp.arms.map((a) => (
                  <Badge key={a.id} variant="outline">
                    {a.label}: {a.assigned}/{exp.minPerArm}
                  </Badge>
                ))}
              </div>
              {exp.status === "running" && (
                <Button size="sm" variant="destructive" onClick={() => void stop(exp.id)}>
                  Stop
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
