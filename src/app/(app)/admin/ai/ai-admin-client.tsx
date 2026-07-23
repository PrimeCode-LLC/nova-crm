"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { adminSubSectionTabs } from "@/lib/admin-sections";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Sparkles, Download } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { formatUsd } from "@/lib/ai/pricing-table";
import type { AiFeatureKey, AiProvider, OrganizationAiSettings } from "@/lib/ai/types";
import { AI_PROMPT_DEFAULTS } from "@/lib/ai/prompt-defaults";
import { FitKnowledgeAdminPanel } from "@/components/admin/fit-knowledge-admin-panel";

const FEATURES: { key: AiFeatureKey; label: string }[] = [
  { key: "dashboard_brief", label: "Dashboard overview" },
  { key: "lead_analyze", label: "Lead analysis" },
  { key: "intent_suggest", label: "Intent signal suggest" },
  { key: "prospect_draft_extract", label: "Prospect draft extraction" },
  { key: "followup_suggest", label: "Follow-up suggestions" },
  { key: "email_reply", label: "Email reply" },
  { key: "opportunity_fit", label: "Opportunity fit check" },
  { key: "opportunity_fit_discuss", label: "Fit check, discuss" },
  { key: "content_capture_normalize", label: "Content capture normalize" },
  { key: "content_plan_suggest", label: "Content plan suggest" },
  { key: "content_draft_generate", label: "Content draft generate" },
  { key: "content_graphics_brief", label: "Content graphics brief" },
];

export function AiAdminClient() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = React.useState("setup");
  React.useEffect(() => {
    const t = searchParams.get("tab");
    if (t && adminSubSectionTabs("/admin/ai").includes(t)) setActiveTab(t);
  }, [searchParams]);
  const [loading, setLoading] = React.useState(true);
  const [settings, setSettings] = React.useState<OrganizationAiSettings | null>(null);
  const [keyFlags, setKeyFlags] = React.useState({ openai: false, anthropic: false, google: false });
  const [openaiKey, setOpenaiKey] = React.useState("");
  const [anthropicKey, setAnthropicKey] = React.useState("");
  const [googleKey, setGoogleKey] = React.useState("");
  const [promptFeature, setPromptFeature] = React.useState<AiFeatureKey>("dashboard_brief");
  const [systemPrompt, setSystemPrompt] = React.useState("");
  const [userPrompt, setUserPrompt] = React.useState("");
  const [usage, setUsage] = React.useState<{
    totals: { requests: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number };
    daily: { date: string; requestCount: number; totalInputTokens: number; totalOutputTokens: number }[];
    byUser: { userId: string; displayName?: string; requests: number; inputTokens: number; outputTokens: number }[];
    byFeature: { feature: string; requests: number; inputTokens: number; outputTokens: number }[];
  } | null>(null);
  const [libraries, setLibraries] = React.useState<{ id: string; name: string; scope: unknown }[]>([]);
  const [newLibName, setNewLibName] = React.useState("");
  const [docTitle, setDocTitle] = React.useState("");
  const [docContent, setDocContent] = React.useState("");
  const [selectedLib, setSelectedLib] = React.useState("");
  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, uRes, lRes] = await Promise.all([
        fetch("/api/ai/settings"),
        fetch("/api/ai/usage?range=30d"),
        fetch("/api/ai/rag/libraries"),
      ]);
      if (sRes.ok) {
        const s = await sRes.json();
        setSettings(s.settings);
        setKeyFlags(s.keyFlags);
      }
      if (uRes.ok) setUsage(await uRes.json());
      if (lRes.ok) {
        const l = await lRes.json();
        setLibraries(l.libraries ?? []);
        if (l.libraries?.[0] && !selectedLib) setSelectedLib(l.libraries[0].id);
      }
      const pRes = await fetch(`/api/ai/prompts?feature=${promptFeature}`);
      if (pRes.ok) {
        const p = await pRes.json();
        setSystemPrompt(p.prompt.systemPrompt);
        setUserPrompt(p.prompt.userPromptTemplate);
      }
    } finally {
      setLoading(false);
    }
  }, [promptFeature, selectedLib]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/ai/prompts?feature=${promptFeature}`);
      if (res.ok) {
        const p = await res.json();
        setSystemPrompt(p.prompt.systemPrompt);
        setUserPrompt(p.prompt.userPromptTemplate);
      }
    })();
  }, [promptFeature]);

  async function saveSettings(patch: Partial<OrganizationAiSettings>) {
    const res = await fetch("/api/ai/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      toast.error("Could not save settings");
      return;
    }
    const data = await res.json();
    setSettings(data.settings);
    toast.success("Settings saved");
  }

  async function saveKeys() {
    const body: Record<string, string> = {};
    if (openaiKey.trim()) body.openai = openaiKey.trim();
    if (anthropicKey.trim()) body.anthropic = anthropicKey.trim();
    if (googleKey.trim()) body.google = googleKey.trim();
    const res = await fetch("/api/ai/provider-keys", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      toast.error("Could not save API keys");
      return;
    }
    const data = await res.json();
    setKeyFlags(data.keyFlags);
    setOpenaiKey("");
    setAnthropicKey("");
    setGoogleKey("");
    toast.success("API keys updated");
  }

  async function savePrompt() {
    const res = await fetch("/api/ai/prompts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        featureKey: promptFeature,
        systemPrompt,
        userPromptTemplate: userPrompt,
      }),
    });
    if (!res.ok) toast.error("Could not save prompt");
    else toast.success("Prompt saved");
  }

  async function createLibrary() {
    if (!newLibName.trim()) return;
    const res = await fetch("/api/ai/rag/libraries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newLibName.trim(), scope: { type: "org" } }),
    });
    if (!res.ok) toast.error("Could not create library");
    else {
      toast.success("Library created");
      setNewLibName("");
      void load();
    }
  }

  async function uploadDoc() {
    if (!selectedLib || !docTitle.trim() || !docContent.trim()) return;
    const res = await fetch("/api/ai/rag/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        libraryId: selectedLib,
        title: docTitle.trim(),
        content: docContent.trim(),
        indexNow: true,
      }),
    });
    if (!res.ok) toast.error("Could not add document");
    else {
      toast.success("Document indexed");
      setDocTitle("");
      setDocContent("");
    }
  }

  function exportUsageCsv() {
    if (!usage) return;
    const rows = [
      ["userId", "displayName", "requests", "inputTokens", "outputTokens"],
      ...usage.byUser.map((u) => [
        u.userId,
        u.displayName ?? "",
        String(u.requests),
        String(u.inputTokens),
        String(u.outputTokens),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ai-usage-by-user.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const chartData =
    usage?.daily.map((d) => ({
      date: d.date.slice(5),
      requests: d.requestCount,
    })) ?? [];

  return (
    <>
      <PageHeader
        title="AI & knowledge"
        description="Configure providers, prompts, RAG libraries, and monitor usage."
      />
      <PageBody>
        {loading && !settings ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList>
              <TabsTrigger value="setup">Setup</TabsTrigger>
              <TabsTrigger value="prompts">Prompts</TabsTrigger>
              <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
              <TabsTrigger value="usage">Usage</TabsTrigger>
            </TabsList>

            <TabsContent value="setup" className="space-y-4 max-w-2xl">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Sparkles className="h-4 w-4" /> Platform AI
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Org must supply API keys. Keys are encrypted server-side.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="ai-enabled">Enable AI features</Label>
                    <Switch
                      id="ai-enabled"
                      checked={settings?.enabled ?? false}
                      onCheckedChange={(v) => void saveSettings({ enabled: !!v })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Default provider</Label>
                    <Select
                      value={settings?.defaultProvider ?? "openai"}
                      onValueChange={(v) =>
                        void saveSettings({ defaultProvider: v as AiProvider })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="anthropic">Anthropic</SelectItem>
                        <SelectItem value="google">Google</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Default model</Label>
                    <Input
                      value={settings?.defaultModel ?? ""}
                      onChange={(e) =>
                        setSettings((s) => (s ? { ...s, defaultModel: e.target.value } : s))
                      }
                      onBlur={() =>
                        settings && void saveSettings({ defaultModel: settings.defaultModel })
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">API keys</CardTitle>
                  <CardDescription className="text-xs">
                    OpenAI {keyFlags.openai ? "✓" : "-"} · Anthropic {keyFlags.anthropic ? "✓" : "-"} · Google{" "}
                    {keyFlags.google ? "✓" : "-"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-2">
                    <Label>OpenAI key</Label>
                    <Input
                      type="password"
                      placeholder={keyFlags.openai ? "Replace key…" : "sk-…"}
                      value={openaiKey}
                      onChange={(e) => setOpenaiKey(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Anthropic key</Label>
                    <Input
                      type="password"
                      placeholder={keyFlags.anthropic ? "Replace key…" : "sk-ant-…"}
                      value={anthropicKey}
                      onChange={(e) => setAnthropicKey(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Google key</Label>
                    <Input
                      type="password"
                      placeholder={keyFlags.google ? "Replace key…" : "AIza…"}
                      value={googleKey}
                      onChange={(e) => setGoogleKey(e.target.value)}
                    />
                  </div>
                  <Button type="button" onClick={() => void saveKeys()}>
                    Save keys
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="prompts" className="space-y-4 max-w-3xl">
              <div className="flex gap-2 flex-wrap">
                {FEATURES.map((f) => (
                  <Button
                    key={f.key}
                    type="button"
                    variant={promptFeature === f.key ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPromptFeature(f.key)}
                  >
                    {f.label}
                  </Button>
                ))}
              </div>
              <div className="grid gap-2">
                <Label>System prompt</Label>
                <Textarea
                  className="min-h-[120px] font-mono text-xs"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>User template</Label>
                <Textarea
                  className="min-h-[160px] font-mono text-xs"
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button type="button" onClick={() => void savePrompt()}>
                  Save prompt
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const d = AI_PROMPT_DEFAULTS[promptFeature];
                    setSystemPrompt(d.systemPrompt);
                    setUserPrompt(d.userPromptTemplate);
                  }}
                >
                  Reset to default
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="knowledge" className="space-y-4">
              <FitKnowledgeAdminPanel
                aiEnabled={settings?.enabled ?? false}
                onSeeded={() => void load()}
              />
              <Card className="max-w-2xl">
                <CardHeader>
                  <CardTitle className="text-sm">Libraries</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ul className="text-sm space-y-1">
                    {libraries.map((l) => (
                      <li key={l.id}>
                        <button
                          type="button"
                          className={selectedLib === l.id ? "font-semibold" : ""}
                          onClick={() => setSelectedLib(l.id)}
                        >
                          {l.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="flex gap-2">
                    <Input
                      placeholder="New library name"
                      value={newLibName}
                      onChange={(e) => setNewLibName(e.target.value)}
                    />
                    <Button type="button" onClick={() => void createLibrary()}>
                      Add
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Add document</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input
                    placeholder="Title"
                    value={docTitle}
                    onChange={(e) => setDocTitle(e.target.value)}
                  />
                  <Textarea
                    className="min-h-[200px]"
                    placeholder="Markdown content…"
                    value={docContent}
                    onChange={(e) => setDocContent(e.target.value)}
                  />
                  <Button type="button" disabled={!selectedLib} onClick={() => void uploadDoc()}>
                    Upload & index
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="usage" className="space-y-4">
              {usage && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Card>
                      <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground">Requests (30d)</p>
                        <p className="text-2xl font-semibold tabular-nums">{usage.totals.requests}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground">Input tokens</p>
                        <p className="text-2xl font-semibold tabular-nums">
                          {usage.totals.inputTokens.toLocaleString()}
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground">Output tokens</p>
                        <p className="text-2xl font-semibold tabular-nums">
                          {usage.totals.outputTokens.toLocaleString()}
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground">Est. cost</p>
                        <p className="text-2xl font-semibold tabular-nums">
                          {formatUsd(usage.totals.estimatedCostUsd)}
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="text-sm">Daily requests</CardTitle>
                      <Button type="button" variant="outline" size="sm" onClick={exportUsageCsv}>
                        <Download className="h-3.5 w-3.5 mr-1" /> Export users CSV
                      </Button>
                    </CardHeader>
                    <CardContent className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip />
                          <Bar dataKey="requests" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">By user</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>User</TableHead>
                            <TableHead className="text-right">Requests</TableHead>
                            <TableHead className="text-right">Tokens in</TableHead>
                            <TableHead className="text-right">Tokens out</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {usage.byUser.map((u) => (
                            <TableRow key={u.userId}>
                              <TableCell className="text-xs">
                                {u.displayName ?? u.userId}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs">
                                {u.requests}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs">
                                {u.inputTokens.toLocaleString()}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs">
                                {u.outputTokens.toLocaleString()}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">By feature</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Feature</TableHead>
                            <TableHead className="text-right">Requests</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {usage.byFeature.map((f) => (
                            <TableRow key={f.feature}>
                              <TableCell className="text-xs">{f.feature}</TableCell>
                              <TableCell className="text-right tabular-nums text-xs">
                                {f.requests}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </>
              )}
            </TabsContent>
          </Tabs>
        )}
      </PageBody>
    </>
  );
}
