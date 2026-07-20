"use client";

import * as React from "react";
import { Eye, Pencil } from "lucide-react";

import { MarkdownContent } from "@/components/common/markdown-content";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type MarkdownFieldProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  /** Default to preview when content looks like markdown. */
  defaultMode?: "preview" | "edit";
  mono?: boolean;
};

function looksLikeMarkdown(text: string): boolean {
  return /(^#{1,3}\s)|\*\*[^*]+\*\*|^\s*[-*]\s|^\s*\d+\.\s/m.test(text);
}

/** Editable markdown field with Preview / Edit so AI content isn't shown as raw `**` / `##`. */
export function MarkdownField({
  value,
  onChange,
  placeholder,
  rows = 8,
  className,
  defaultMode,
  mono = false,
}: MarkdownFieldProps) {
  const [mode, setMode] = React.useState<"preview" | "edit">(
    () => defaultMode ?? (value.trim() && looksLikeMarkdown(value) ? "preview" : "edit"),
  );

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-end gap-1">
        <Button
          type="button"
          size="xs"
          variant={mode === "preview" ? "secondary" : "ghost"}
          className="h-6 gap-1 px-2 text-[11px]"
          onClick={() => setMode("preview")}
          disabled={!value.trim()}
        >
          <Eye className="size-3" />
          Preview
        </Button>
        <Button
          type="button"
          size="xs"
          variant={mode === "edit" ? "secondary" : "ghost"}
          className="h-6 gap-1 px-2 text-[11px]"
          onClick={() => setMode("edit")}
        >
          <Pencil className="size-3" />
          Edit
        </Button>
      </div>
      {mode === "preview" ? (
        <div className="min-h-[6rem] rounded-lg border bg-muted/20 px-3 py-2.5">
          {value.trim() ? (
            <MarkdownContent>{value}</MarkdownContent>
          ) : (
            <p className="text-sm text-muted-foreground">{placeholder ?? "Nothing to preview."}</p>
          )}
        </div>
      ) : (
        <Textarea
          rows={rows}
          className={cn(mono && "font-mono text-xs")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}
