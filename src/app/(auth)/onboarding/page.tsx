"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Building2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isAuthDisabled } from "@/lib/auth/flags";
import { isClerkAuthV1Enabled } from "@/lib/auth/clerk-flags";
import { peekInviteTokens } from "@/components/providers/clerk-invite-stash";

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [inviteInFlight, setInviteInFlight] = React.useState(false);

  React.useEffect(() => {
    if (isAuthDisabled()) return;
    // Invitee landing here while membership sync runs — don't flash "create workspace".
    const tokens = peekInviteTokens();
    if (tokens.inviteToken || tokens.openJoinToken) {
      setInviteInFlight(true);
    }
    let cancelled = false;
    const checkMe = async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          membershipPending?: boolean;
          organizationId?: string | null;
        };
        if (cancelled) return;
        if (data.membershipPending) {
          router.replace("/join/pending");
          return;
        }
        if (data.organizationId) {
          router.replace("/dashboard");
        }
      } catch {
        /* ignore */
      }
    };
    void checkMe();
    const interval = window.setInterval(() => {
      void checkMe();
    }, 1500);
    const giveUp = window.setTimeout(() => {
      if (!cancelled) setInviteInFlight(false);
    }, 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.clearTimeout(giveUp);
    };
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: name.trim() }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not create workspace");
      toast.success("Workspace created");
      // Force a reload so the server picks up new claims/cookie.
      window.location.replace("/dashboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
      setSubmitting(false);
    }
  }

  if (inviteInFlight) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Joining your workspace…</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Building2 className="h-5 w-5" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight">
          Set up your workspace
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a name for your company. You can change it later in settings.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs" htmlFor="company">
            Company / workspace name
          </Label>
          <Input
            id="company"
            placeholder="Acme Inc."
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>
        <Button type="submit" className="w-full" disabled={submitting || !name.trim()}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting ? "Creating…" : "Create workspace"}
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        Have an invite link?{" "}
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => router.replace(isClerkAuthV1Enabled() ? "/sign-in" : "/login")}
        >
          Sign in instead
        </button>
      </p>
    </div>
  );
}
