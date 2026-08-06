"use client";

import * as React from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type WaitlistFormProps = {
  className?: string;
  size?: "default" | "lg";
  source?: string;
  showCompany?: boolean;
  ctaLabel?: string;
};

export function WaitlistForm({
  className,
  size = "lg",
  showCompany = false,
  ctaLabel = "Join the waitlist",
}: WaitlistFormProps) {
  const [email, setEmail] = React.useState("");
  const [company, setCompany] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error("Enter your work email to join the waitlist.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/marketing/interest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "waitlist",
          email: trimmed,
          company: company.trim() || undefined,
          website,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error || "Could not join the waitlist.");
        return;
      }
      setDone(true);
      setEmail("");
      setCompany("");
      toast.success("You're on the list. We'll reach out soon.");
    } catch {
      toast.error("Network error. Try again or email sales@stellixsoft.com.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-200",
          className,
        )}
      >
        You&apos;re on the waitlist. We&apos;ll email you when Nova is ready for
        your team.
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "flex w-full flex-col gap-3",
        showCompany ? "" : "sm:flex-row sm:items-stretch",
        className,
      )}
    >
      {/* Honeypot */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="pointer-events-none absolute h-0 w-0 opacity-0"
      />

      <div className={cn("flex flex-1 flex-col gap-3", showCompany && "sm:flex-row")}>
        <Input
          type="email"
          name="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Work email"
          className={cn(
            "h-11 flex-1 bg-background/70",
            size === "lg" && "h-12 text-base",
          )}
          autoComplete="email"
        />
        {showCompany && (
          <Input
            type="text"
            name="company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company (optional)"
            className={cn(
              "h-11 flex-1 bg-background/70",
              size === "lg" && "h-12 text-base",
            )}
            autoComplete="organization"
          />
        )}
      </div>

      <Button
        type="submit"
        size={size === "lg" ? "lg" : "default"}
        disabled={submitting}
        className={cn(size === "lg" && "h-12 px-6", "shrink-0")}
      >
        {submitting ? (
          <>
            <Loader2 className="animate-spin" />
            Joining…
          </>
        ) : (
          <>
            {ctaLabel}
            <ArrowRight />
          </>
        )}
      </Button>
    </form>
  );
}
