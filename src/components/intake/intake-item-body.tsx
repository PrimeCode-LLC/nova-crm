"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ScraperRawItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const fullTextCache = new Map<string, string>();

function toPlainText(raw: string): string {
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function previewText(item: ScraperRawItem): string {
  const snippet = item.contentSnippet?.trim();
  if (snippet) return toPlainText(snippet);
  return toPlainText(item.content).slice(0, 320);
}

export function IntakeItemBody({ item }: { item: ScraperRawItem }) {
  const preview = previewText(item);
  const [expanded, setExpanded] = React.useState(false);
  const [fullText, setFullText] = React.useState<string | null>(
    () => fullTextCache.get(item.id) ?? null,
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const previewRef = React.useRef<HTMLParagraphElement>(null);
  const [canExpand, setCanExpand] = React.useState(preview.length > 160);

  React.useEffect(() => {
    setExpanded(false);
    setError(null);
    setFullText(fullTextCache.get(item.id) ?? null);
  }, [item.id]);

  React.useLayoutEffect(() => {
    if (expanded) return;
    const el = previewRef.current;
    const overflows = Boolean(el && el.scrollHeight > el.clientHeight + 1);
    const listLikelyTruncated =
      preview.length >= 300 || (item.content?.length ?? 0) >= 790;
    const fullLonger = Boolean(fullText && fullText.length > preview.length + 20);
    setCanExpand(overflows || listLikelyTruncated || fullLonger);
  }, [preview, expanded, item.content, fullText]);

  async function expand() {
    setExpanded(true);
    if (fullText) return;

    const cached = fullTextCache.get(item.id);
    if (cached) {
      setFullText(cached);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/org/scraper-raw/${encodeURIComponent(item.id)}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = (await res.json()) as { item?: ScraperRawItem; error?: string };
      if (!res.ok || !data.item) {
        setError(data.error ?? "Could not load full post");
        return;
      }
      const text = toPlainText(data.item.content || data.item.contentSnippet || "");
      fullTextCache.set(item.id, text || preview);
      setFullText(text || preview);
    } catch {
      setError("Network error loading full post");
    } finally {
      setLoading(false);
    }
  }

  const display = expanded ? (fullText ?? preview) : preview;

  return (
    <div className="space-y-1.5">
      <p
        ref={expanded ? undefined : previewRef}
        className={cn(
          "text-sm text-muted-foreground whitespace-pre-wrap",
          !expanded && "line-clamp-3",
        )}
      >
        {display}
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {canExpand || expanded ? (
        <Button
          variant="ghost"
          size="sm"
          type="button"
          className="h-7 px-2 text-xs text-muted-foreground"
          disabled={loading}
          onClick={() => {
            if (expanded) setExpanded(false);
            else void expand();
          }}
        >
          {loading ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </>
          ) : expanded ? (
            <>
              <ChevronUp className="h-3 w-3" /> Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" /> Read more
            </>
          )}
        </Button>
      ) : null}
    </div>
  );
}
