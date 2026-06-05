"use client";

import * as React from "react";
import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { normalizeKeywordList, parseKeywordInput } from "@/lib/intake/keyword-filter";

export function KeywordListInput({
  id,
  label,
  description,
  keywords,
  lockedKeywords = [],
  onChange,
  placeholder = "Type a keyword and press Enter…",
  tone = "neutral",
  className,
  readOnly = false,
}: {
  id: string;
  label: string;
  description?: string;
  keywords: string[];
  /** Shown as non-removable badges (e.g. team defaults). */
  lockedKeywords?: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  tone?: "include" | "exclude" | "neutral";
  className?: string;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  function addKeywords(rawParts: string[]) {
    const next = normalizeKeywordList([...keywords, ...parseKeywordInput(rawParts.join(","))]);
    if (next.length !== keywords.length || next.some((k, i) => k !== keywords[i])) {
      onChange(next);
    }
  }

  function removeKeyword(keyword: string) {
    onChange(keywords.filter((k) => k !== keyword));
  }

  function commitDraft() {
    if (!draft.trim()) return;
    addKeywords([draft]);
    setDraft("");
  }

  const badgeClass =
    tone === "include"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : tone === "exclude"
        ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
        : undefined;
  const lockedBadgeClass =
    tone === "include"
      ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-800 dark:text-emerald-200"
      : tone === "exclude"
        ? "border-red-500/40 bg-red-500/5 text-red-800 dark:text-red-200"
        : "border-muted-foreground/30 bg-muted/40";

  return (
    <div className={cn("space-y-2", className)}>
      <div className="space-y-1">
        <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
          {label}
        </Label>
        {description ? (
          <p className="text-xs leading-relaxed text-muted-foreground/80">{description}</p>
        ) : null}
      </div>
      <div
        className={cn(
          "flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1.5",
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        )}
        onClick={() => !readOnly && inputRef.current?.focus()}
      >
        {lockedKeywords.map((keyword) => (
          <Badge
            key={`locked-${keyword}`}
            variant="outline"
            className={cn("h-6 font-normal", lockedBadgeClass)}
            title="Team default, managed by admins"
          >
            {keyword}
            <span className="text-[10px] uppercase tracking-wide opacity-70">Team</span>
          </Badge>
        ))}
        {keywords.map((keyword) => (
          <Badge
            key={keyword}
            variant="outline"
            className={cn("h-6 gap-1 pr-1 font-normal", badgeClass)}
          >
            {keyword}
            <button
              type="button"
              className="rounded-sm p-0.5 hover:bg-foreground/10"
              aria-label={`Remove ${keyword}`}
              onClick={(e) => {
                e.stopPropagation();
                removeKeyword(keyword);
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {!readOnly ? (
          <Input
            ref={inputRef}
            id={id}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                commitDraft();
              } else if (e.key === "Backspace" && !draft && keywords.length > 0) {
                removeKeyword(keywords[keywords.length - 1]!);
              }
            }}
            onBlur={commitDraft}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (!text.includes(",") && !text.includes("\n") && !text.includes(";")) return;
              e.preventDefault();
              addKeywords([text]);
              setDraft("");
            }}
            placeholder={
              lockedKeywords.length + keywords.length === 0 ? placeholder : "Add another…"
            }
            className="h-7 min-w-[8rem] flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
            aria-label={`${label} keyword input`}
          />
        ) : lockedKeywords.length === 0 ? (
          <span className="px-1 text-xs text-muted-foreground">No keywords set</span>
        ) : null}
      </div>
    </div>
  );
}
