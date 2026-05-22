"use client";

import * as React from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function OutreachConnectionBanner() {
  const [connected, setConnected] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/integrations/instantly/connection");
        if (!res.ok) {
          setConnected(false);
          return;
        }
        const data = (await res.json()) as { connected?: boolean };
        setConnected(Boolean(data.connected));
      } catch {
        setConnected(false);
      }
    })();
  }, []);

  if (connected !== false) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
      <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium">Instantly not connected</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Connect your Instantly API key to create campaigns, push leads, and sync replies.
        </p>
      </div>
      <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/settings?tab=integrations">Connect</Link>} />
    </div>
  );
}
