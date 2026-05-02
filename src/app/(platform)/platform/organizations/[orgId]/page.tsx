"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Organization } from "@/lib/types";
import { toast } from "sonner";

export default function EditOrganizationPage() {
  const params = useParams();
  const orgId = String(params.orgId ?? "");

  const [org, setOrg] = React.useState<Organization | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [status, setStatus] = React.useState<"trial" | "active" | "suspended">("active");
  const [planId, setPlanId] = React.useState<"free" | "pro" | "enterprise">("free");
  const [maxUsers, setMaxUsers] = React.useState("");
  const [billingEmail, setBillingEmail] = React.useState("");
  const [operatorNotes, setOperatorNotes] = React.useState("");
  const [inboundWebhookSecret, setInboundWebhookSecret] = React.useState("");
  const [hasInboundWebhookSecret, setHasInboundWebhookSecret] =
    React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/platform/organizations/${orgId}`);
        const data = (await res.json()) as { organization?: Organization; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Not found");
        const o = data.organization;
        if (!cancelled && o) {
          setOrg(o);
          setName(o.name);
          setSlug(o.slug);
          setStatus(o.status);
          setPlanId(o.planId);
          setMaxUsers(o.maxUsers != null ? String(o.maxUsers) : "");
          setBillingEmail(o.settings.billingEmail ?? "");
          setOperatorNotes(o.settings.operatorNotes ?? "");
          setInboundWebhookSecret("");
          setHasInboundWebhookSecret(Boolean(o.hasInboundWebhookSecret));
        }
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const maxParsed = maxUsers.trim() ? parseInt(maxUsers, 10) : null;
      const settings: {
        billingEmail?: string;
        operatorNotes?: string;
        inboundWebhookSecret?: string;
      } = {
        billingEmail: billingEmail.trim() || undefined,
        operatorNotes: operatorNotes.trim() || undefined,
      };
      const trimmedSecret = inboundWebhookSecret.trim();
      if (trimmedSecret) {
        settings.inboundWebhookSecret = trimmedSecret;
      }

      const res = await fetch(`/api/platform/organizations/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          slug,
          status,
          planId,
          maxUsers: maxParsed === null || Number.isNaN(maxParsed) ? null : maxParsed,
          settings,
        }),
      });
      const data = (await res.json()) as { error?: unknown };
      if (!res.ok) {
        const msg =
          typeof data.error === "string"
            ? data.error
            : JSON.stringify(data.error ?? "Save failed");
        throw new Error(msg);
      }
      toast.success("Saved");
      setInboundWebhookSecret("");
      if (trimmedSecret) setHasInboundWebhookSecret(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!org) {
    return (
      <p className="text-sm text-destructive">
        Organization not found.{" "}
        <Link href="/platform/organizations" className="underline">
          Back to list
        </Link>
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <div>
        <Link
          href="/platform/organizations"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Organizations
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Edit tenant</h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{org.id}</p>
      </div>

      <form onSubmit={onSave} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="name">Display name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="slug">Slug</Label>
          <Input id="slug" value={slug} onChange={(e) => setSlug(e.target.value)} required />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="trial">Trial</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Plan</Label>
            <Select value={planId} onValueChange={(v) => setPlanId(v as typeof planId)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="pro">Pro</SelectItem>
                <SelectItem value="enterprise">Enterprise</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="maxUsers">Max users (optional)</Label>
          <Input
            id="maxUsers"
            inputMode="numeric"
            value={maxUsers}
            onChange={(e) => setMaxUsers(e.target.value)}
            placeholder="Unlimited if empty"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="billing">Billing email</Label>
          <Input
            id="billing"
            type="email"
            value={billingEmail}
            onChange={(e) => setBillingEmail(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes">Operator notes</Label>
          <Input
            id="notes"
            value={operatorNotes}
            onChange={(e) => setOperatorNotes(e.target.value)}
          />
        </div>
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <Label htmlFor="webhook-secret">Inbound lead webhook secret</Label>
          <p className="text-xs text-muted-foreground">
            Stored per tenant under <code className="rounded bg-muted px-1">settings.inboundWebhookSecret</code>.
            Used with <code className="rounded bg-muted px-1">POST /api/integrations/webhook/lead</code>{" "}
            and body field <code className="rounded bg-muted px-1">organizationId</code>. Type a new
            secret and save the form, or clear the per-tenant secret below (then the env fallback applies).
          </p>
          <p className="text-xs text-muted-foreground">
            Status:{" "}
            {hasInboundWebhookSecret ? (
              <span className="text-success">secret configured</span>
            ) : (
              <span>not set (falls back to INBOUND_WEBHOOK_SECRET env)</span>
            )}
          </p>
          <Input
            id="webhook-secret"
            type="password"
            autoComplete="new-password"
            value={inboundWebhookSecret}
            onChange={(e) => setInboundWebhookSecret(e.target.value)}
            placeholder="New secret (min 8 characters recommended)"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasInboundWebhookSecret}
            onClick={() => {
              void (async () => {
                if (!confirm("Remove the per-tenant webhook secret?")) return;
                try {
                  const res = await fetch(`/api/platform/organizations/${orgId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      settings: { inboundWebhookSecret: "" },
                    }),
                  });
                  if (!res.ok) throw new Error("Failed");
                  setHasInboundWebhookSecret(false);
                  toast.success("Webhook secret cleared");
                } catch {
                  toast.error("Could not clear secret");
                }
              })();
            }}
          >
            Clear per-tenant secret
          </Button>
        </div>
        <button type="submit" disabled={saving} className={cn(buttonVariants())}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </form>
    </div>
  );
}
