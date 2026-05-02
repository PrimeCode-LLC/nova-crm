"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FlaskConical, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEMO_ROLE_PRESETS } from "@/lib/demo-persona";
import { setDemoExplorationCookies, startDemoExploration } from "@/app/(app)/actions/demo-persona";
import { isAuthDisabled } from "@/lib/auth/flags";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";

export function DemoRolePicker() {
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  async function choose(personaId: string) {
    setPendingId(personaId);
    try {
      if (isAuthDisabled()) {
        await startDemoExploration(personaId);
        return;
      }
      await setDemoExplorationCookies(personaId);
      if (!isFirebaseWebConfigured()) {
        toast.success("Demo mode + sample role saved. Enable Firebase to sign in, or turn on auth bypass for instant access.");
        router.push("/dashboard");
        return;
      }
      toast.success("Demo mode and sample role saved. Sign in below; the app will open in Demo as that user.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start demo";
      toast.error(msg);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Card className="border-warning/25 bg-warning/[0.04]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-warning" />
          Try the app with sample roles
        </CardTitle>
        <CardDescription className="text-xs leading-relaxed">
          Each role uses the same demo pipeline but switches your <strong className="text-foreground">profile</strong>{" "}
          and <strong className="text-foreground">Settings</strong> context so you can compare Admin → Users &
          Permissions.{" "}
          {isAuthDisabled()
            ? "Auth is off: one click opens the dashboard."
            : "We save your pick; sign in next, then use the account menu to change role anytime in Demo mode."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {DEMO_ROLE_PRESETS.map((p) => (
          <Button
            key={p.userId}
            type="button"
            variant="outline"
            size="sm"
            className="h-auto min-h-11 flex-col items-stretch gap-0.5 py-2 px-3 text-left border-warning/20 hover:bg-warning/10"
            disabled={pendingId !== null}
            onClick={() => void choose(p.userId)}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground">{p.title}</span>
              {pendingId === p.userId && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
            </span>
            <span className="text-[10px] text-muted-foreground leading-snug line-clamp-2">{p.permissionHint}</span>
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}
