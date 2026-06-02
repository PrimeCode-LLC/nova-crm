"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { KeywordListInput } from "@/components/intake/keyword-list-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OrganizationIntakeFilterDefaults } from "@/lib/types";
import { EMPTY_INTAKE_FILTER_DEFAULTS } from "@/lib/intake/intake-filter-defaults";

export function TeamIntakeFilterDefaultsCard({ disabled }: { disabled?: boolean }) {
  const [defaults, setDefaults] = React.useState<OrganizationIntakeFilterDefaults>({
    ...EMPTY_INTAKE_FILTER_DEFAULTS,
  });
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    if (disabled) {
      setLoading(false);
      return;
    }
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/org/intake-filter-defaults", { credentials: "same-origin" });
        const data = (await res.json()) as {
          defaults?: OrganizationIntakeFilterDefaults;
          error?: string;
        };
        if (!res.ok) {
          toast.error(data.error ?? "Could not load team intake filters");
          return;
        }
        setDefaults(data.defaults ?? { ...EMPTY_INTAKE_FILTER_DEFAULTS });
        setDirty(false);
      } catch {
        toast.error("Network error loading team intake filters");
      } finally {
        setLoading(false);
      }
    })();
  }, [disabled]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/org/intake-filter-defaults", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(defaults),
      });
      const data = (await res.json()) as {
        defaults?: OrganizationIntakeFilterDefaults;
        error?: string;
      };
      if (!res.ok) {
        toast.error(data.error ?? "Save failed");
        return;
      }
      setDefaults(data.defaults ?? defaults);
      setDirty(false);
      toast.success("Team intake filters saved", {
        description: "All users will see these keywords applied in the intake pool.",
      });
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card id="team-intake-filters" size="sm">
      <CardHeader className="gap-1.5 pb-0">
        <CardTitle>Team intake filters</CardTitle>
        <CardDescription className="leading-relaxed">
          Default include and exclude keyword lists for the whole workspace. Every user sees these
          applied when they open the intake pool; they can still add personal keywords on top.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-3">
        {loading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : (
          <>
            <div className="grid items-start gap-4 md:grid-cols-2">
              <KeywordListInput
                id="team-intake-include-keywords"
                label="Team include keywords"
                description="Posts must match at least one of these words to appear for everyone."
                keywords={defaults.includeKeywords}
                onChange={(next) => {
                  setDefaults((prev) => ({ ...prev, includeKeywords: next }));
                  setDirty(true);
                }}
                placeholder="e.g. .net, full stack"
                tone="include"
              />
              <KeywordListInput
                id="team-intake-exclude-keywords"
                label="Team exclude keywords"
                description="Posts matching any of these words are hidden for everyone."
                keywords={defaults.excludeKeywords}
                onChange={(next) => {
                  setDefaults((prev) => ({ ...prev, excludeKeywords: next }));
                  setDirty(true);
                }}
                placeholder="e.g. python, django, intern"
                tone="exclude"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                type="button"
                disabled={disabled || saving || !dirty}
                onClick={() => void save()}
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Save team defaults
              </Button>
              <Button
                variant="outline"
                size="sm"
                type="button"
                disabled={disabled || saving || !dirty}
                onClick={() => {
                  setDefaults({ ...EMPTY_INTAKE_FILTER_DEFAULTS });
                  setDirty(true);
                }}
              >
                Reset draft
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
