"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FollowupSequenceMode, ScriptCategory, ScriptLibraryItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { listDemoScriptsForViewer } from "@/lib/demo-script-library";
import {
  mergeDemoScriptsSession,
  readDemoScriptsSession,
} from "@/lib/demo-scripts-session";

const NONE_VALUE = "__none__";
const LAST_USED_KEY = "crm-followup-template-script-id";

const CATEGORY_LABEL: Record<ScriptCategory, string> = {
  pitch: "Pitch",
  rebuttal: "Rebuttal",
  email_template: "Email template",
  call_script: "Call script",
  meeting_agenda: "Meeting agenda",
  followup_template: "Follow-up template",
  other: "Other",
};

function fieldLabels(category: ScriptCategory): { primary: string; secondary: string } {
  if (category === "email_template") {
    return { primary: "Email subject", secondary: "Email body" };
  }
  if (category === "followup_template") {
    return { primary: "Follow-up opener", secondary: "Follow-up body" };
  }
  return { primary: "Primary", secondary: "Secondary" };
}

function categoriesForMode(mode: FollowupSequenceMode): ScriptCategory[] {
  if (mode === "continue") return ["followup_template", "email_template"];
  return ["email_template"];
}

function filterAndSort(
  items: ScriptLibraryItem[],
  mode: FollowupSequenceMode,
): ScriptLibraryItem[] {
  const allowed = new Set(categoriesForMode(mode));
  const filtered = items.filter((s) => allowed.has(s.category));
  const preferFollowup = mode === "continue";
  filtered.sort((a, b) => {
    if (preferFollowup) {
      const aF = a.category === "followup_template" ? 0 : 1;
      const bF = b.category === "followup_template" ? 0 : 1;
      if (aF !== bF) return aF - bF;
    }
    return a.title.localeCompare(b.title);
  });
  return filtered;
}

function optionLabel(s: ScriptLibraryItem): string {
  return `${s.title} · ${CATEGORY_LABEL[s.category] ?? s.category}`;
}

export function readLastUsedTemplateScriptId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_USED_KEY);
  } catch {
    return null;
  }
}

export function writeLastUsedTemplateScriptId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!id) window.localStorage.removeItem(LAST_USED_KEY);
    else window.localStorage.setItem(LAST_USED_KEY, id);
  } catch {
    /* quota */
  }
}

export function ScriptTemplatePicker({
  isDemo,
  viewerId,
  sequenceMode,
  value,
  onChange,
  preferredScriptId,
}: {
  isDemo: boolean;
  viewerId: string;
  sequenceMode: FollowupSequenceMode;
  /** Empty string = none selected (optional). */
  value: string;
  onChange: (scriptId: string, item: ScriptLibraryItem | null) => void;
  /** Prefill when regenerating from a plan that stored sourceScriptId. */
  preferredScriptId?: string;
}) {
  const [items, setItems] = React.useState<ScriptLibraryItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewExtended, setPreviewExtended] = React.useState(false);
  const hydratedRef = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        if (isDemo) {
          const base = listDemoScriptsForViewer(viewerId);
          const merged = mergeDemoScriptsSession(base, readDemoScriptsSession());
          if (!cancelled) setItems(merged);
          return;
        }
        const res = await fetch("/api/org/scripts");
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          setItems(Array.isArray(data.items) ? (data.items as ScriptLibraryItem[]) : []);
        }
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [isDemo, viewerId]);

  const options = filterAndSort(items, sequenceMode);
  const selected = options.find((s) => s.id === value) ?? null;
  const triggerLabel = selected
    ? optionLabel(selected)
    : value
      ? undefined
      : "None - AI only";

  React.useEffect(() => {
    if (loading || hydratedRef.current) return;
    hydratedRef.current = true;
    const preferred =
      preferredScriptId && options.some((s) => s.id === preferredScriptId)
        ? preferredScriptId
        : null;
    const last = readLastUsedTemplateScriptId();
    const lastOk = last && options.some((s) => s.id === last) ? last : null;
    const next = preferred || lastOk || "";
    if (next && next !== value) {
      const item = options.find((s) => s.id === next) ?? null;
      onChange(next, item);
    }
    // Intentionally once after options load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, options, preferredScriptId]);

  React.useEffect(() => {
    if (loading || !value) return;
    if (!options.some((s) => s.id === value)) {
      onChange("", null);
      setPreviewOpen(false);
      setPreviewExtended(false);
    }
  }, [loading, options, value, onChange]);

  React.useEffect(() => {
    if (!selected) {
      setPreviewOpen(false);
      setPreviewExtended(false);
    }
  }, [selected]);

  const labels = selected ? fieldLabels(selected.category) : null;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">Email / follow-up template (optional)</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          disabled={!selected}
          onClick={() => {
            setPreviewOpen((open) => {
              if (open) setPreviewExtended(false);
              return !open;
            });
          }}
        >
          {previewOpen ? (
            <EyeOff className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
          {previewOpen ? "Hide" : "View"}
        </Button>
      </div>
      <Select
        value={value || NONE_VALUE}
        onValueChange={(v) => {
          const id = !v || v === NONE_VALUE ? "" : v;
          const item = id ? (options.find((s) => s.id === id) ?? null) : null;
          onChange(id, item);
          writeLastUsedTemplateScriptId(id || null);
          if (!id) {
            setPreviewOpen(false);
            setPreviewExtended(false);
          }
        }}
        disabled={loading}
      >
        <SelectTrigger className="h-9 text-sm">
          <SelectValue
            placeholder={loading ? "Loading templates…" : "None - AI only"}
          >
            {triggerLabel}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>None - AI only</SelectItem>
          {options.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {optionLabel(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!loading && options.length === 0 ? (
        <p className="text-[10px] text-muted-foreground leading-snug">
          No templates yet. Add an email or follow-up template in the{" "}
          <Link href="/scripts" className="underline underline-offset-2">
            Scripts library
          </Link>
          .
        </p>
      ) : (
        <p className="text-[10px] text-muted-foreground leading-snug">
          Optional. AI matches this template&apos;s style - it will not paste it.
        </p>
      )}

      {previewOpen && selected && labels ? (
        <div className="rounded-md border bg-muted/30 p-3 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{selected.title}</p>
              <p className="text-[11px] text-muted-foreground">
                {CATEGORY_LABEL[selected.category] ?? selected.category}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1 px-2 text-xs"
              onClick={() => setPreviewExtended((e) => !e)}
            >
              {previewExtended ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {previewExtended ? "Collapse" : "Expand"}
            </Button>
          </div>
          <div
            className={cn(
              "space-y-3 overflow-y-auto overscroll-contain pr-1",
              previewExtended ? "max-h-72" : "max-h-36",
            )}
          >
            <div className="grid gap-1.5">
              <p className="text-[11px] font-medium text-muted-foreground">
                {labels.primary}
              </p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {selected.primaryText || "-"}
              </p>
            </div>
            <div className="grid gap-1.5">
              <p className="text-[11px] font-medium text-muted-foreground">
                {labels.secondary}
              </p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {selected.secondaryText?.trim() || "-"}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            nativeButton={false}
            render={<Link href="/scripts" />}
          >
            Edit in Scripts
          </Button>
        </div>
      ) : null}
    </div>
  );
}
