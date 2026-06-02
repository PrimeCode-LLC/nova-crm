"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { INSTANTLY_MERGE_VARIABLES } from "@/lib/integrations/instantly/lead-mapper";
import { cn } from "@/lib/utils";

function mergeTag(token: string) {
  return `{{${token}}}`;
}

export function MergeVariablesList({ className }: { className?: string }) {
  const [copiedToken, setCopiedToken] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!copiedToken) return;
    const t = window.setTimeout(() => setCopiedToken(null), 2000);
    return () => window.clearTimeout(t);
  }, [copiedToken]);

  async function copy(token: string) {
    const text = mergeTag(token);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedToken(token);
      toast.success(`Copied ${text}`);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  return (
    <div className={cn("rounded-lg border bg-muted/20 p-3", className)}>
      <div className="mb-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Merge variables
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Click copy to paste into subject or body. Labels match the Leads table columns. Instantly
          expects <code className="rounded bg-muted px-1 font-mono text-[10px]">{`{{snake_case}}`}</code>.
        </p>
      </div>
      <ul className="divide-y rounded-md border bg-card">
        {INSTANTLY_MERGE_VARIABLES.map((v) => {
          const tag = mergeTag(v.token);
          const copied = copiedToken === v.token;
          return (
            <li
              key={v.token}
              className="flex items-center gap-2 px-3 py-2 text-sm sm:gap-3"
            >
              <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{tag}</code>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{v.label}</p>
                <p className="truncate text-[11px] text-muted-foreground">{v.source}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                aria-label={`Copy ${tag}`}
                onClick={() => void copy(v.token)}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
