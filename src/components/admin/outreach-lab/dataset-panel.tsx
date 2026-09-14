"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type DatasetItem = {
  id: string;
  label: string;
  segment: string;
  active: boolean;
};

export function DatasetPanel() {
  const [items, setItems] = React.useState<DatasetItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/eval-datasets?datasetKey=golden_v1");
      const data = await res.json();
      if (res.ok) setItems(data.items ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function seed() {
    setBusy(true);
    try {
      const res = await fetch("/api/ai/eval-datasets", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Seed failed");
        return;
      }
      if (data.skipped) {
        toast.message(`Dataset already has ${data.skipped} items — skipped reseed`);
      } else {
        toast.success(`Seeded ${data.upserted} golden items`);
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm">Golden dataset</CardTitle>
            <CardDescription>
              Offline eval inputs ({items.length} items). Seed once per org before Run eval.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void seed()}>
            {busy ? "Seeding…" : "Seed golden_v1"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No items yet. Click Seed golden_v1, then Run eval on a config.
          </p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
            {items.map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-2 border-b py-1.5">
                <span>{it.label}</span>
                <Badge variant="outline">{it.segment}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
