"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type AccountRow = {
  email: string;
  status?: number | string;
  warmup_status?: number | string;
};

export function InstantlyAccountsPanel({ connected }: { connected: boolean }) {
  const [loading, setLoading] = React.useState(false);
  const [accounts, setAccounts] = React.useState<AccountRow[]>([]);

  React.useEffect(() => {
    if (!connected) {
      setAccounts([]);
      return;
    }
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/integrations/instantly/accounts");
        if (!res.ok) return;
        const data = (await res.json()) as { accounts?: AccountRow[] };
        setAccounts(data.accounts ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, [connected]);

  if (!connected) return null;

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle className="text-sm">Sending accounts</CardTitle>
        <CardDescription className="text-xs">
          Email accounts connected in Instantly used for outbound campaigns.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : accounts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No accounts returned from Instantly.</p>
        ) : (
          <ul className="space-y-2 max-h-48 overflow-y-auto">
            {accounts.map((a) => (
              <li key={a.email} className="flex items-center justify-between text-xs">
                <span className="font-mono">{a.email}</span>
                {a.status !== undefined && (
                  <span className="text-muted-foreground">{String(a.status)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
