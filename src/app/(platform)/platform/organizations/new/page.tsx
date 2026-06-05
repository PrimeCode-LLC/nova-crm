"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buttonVariants, Button } from "@/components/ui/button";
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
import { toast } from "sonner";
import { Copy, KeyRound } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

type CreateResponse = {
  id?: string;
  slug?: string;
  ownerLinked?: boolean;
  ownerEmail?: string | null;
  ownerLoginProvisioned?: boolean;
  linkedExistingFirebaseUser?: boolean | null;
  setupLink?: string | null;
  setupEmailDelivered?: boolean;
  setupEmailNote?: string;
  error?: unknown;
};

export default function NewOrganizationPage() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [ownerEmail, setOwnerEmail] = React.useState("");
  const [status, setStatus] = React.useState<"trial" | "active" | "suspended">("trial");
  const [planId, setPlanId] = React.useState<"free" | "pro" | "enterprise">("free");
  const [maxUsers, setMaxUsers] = React.useState("");
  const [billingEmail, setBillingEmail] = React.useState("");
  const [operatorNotes, setOperatorNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [created, setCreated] = React.useState<CreateResponse | null>(null);
  const [provisionOwnerLogin, setProvisionOwnerLogin] = React.useState(false);
  const [ownerDisplayName, setOwnerDisplayName] = React.useState("");
  const [ownerPassword, setOwnerPassword] = React.useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setCreated(null);
    try {
      const trimmedOwnerEmail = ownerEmail.trim();
      if (provisionOwnerLogin) {
        if (!trimmedOwnerEmail) {
          toast.error("Owner email is required when creating a login.");
          return;
        }
        if (ownerPassword.trim().length < 8) {
          toast.error("Password must be at least 8 characters.");
          return;
        }
      }
      const maxParsed = maxUsers.trim() ? parseInt(maxUsers, 10) : undefined;
      const res = await fetch("/api/platform/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          slug: slug.trim() || undefined,
          status,
          planId,
          maxUsers:
            maxParsed === undefined || Number.isNaN(maxParsed)
              ? undefined
              : maxParsed,
          ownerEmail: trimmedOwnerEmail || undefined,
          ...(provisionOwnerLogin
            ? {
                ownerPassword: ownerPassword.trim(),
                ownerDisplayName: ownerDisplayName.trim() || undefined,
              }
            : {}),
          settings: {
            billingEmail: billingEmail.trim() || undefined,
            operatorNotes: operatorNotes.trim() || undefined,
          },
        }),
      });
      const data = (await res.json()) as CreateResponse;
      if (!res.ok) {
        const msg =
          typeof data.error === "string"
            ? data.error
            : JSON.stringify(data.error ?? "Request failed");
        throw new Error(msg);
      }
      setCreated(data);
      if (provisionOwnerLogin) {
        setOwnerPassword("");
      }
      toast.success(
        data.ownerLoginProvisioned
          ? data.linkedExistingFirebaseUser
            ? "Organization created, existing login linked as owner"
            : "Organization created, owner can sign in with the password you set"
          : data.ownerLinked
            ? "Organization created and owner linked"
            : data.ownerEmail
              ? "Organization created, owner setup link ready"
              : "Organization created",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSubmitting(false);
    }
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
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">New organization</h1>
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="name">Display name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Acme Corp"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="slug">URL slug (optional)</Label>
          <Input
            id="slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="acme-corp, auto if empty"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="owner">Owner email</Label>
          <Input
            id="owner"
            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            placeholder="founder@acme.com"
            required={provisionOwnerLogin}
          />
          <p className="text-xs text-muted-foreground">
            {provisionOwnerLogin
              ? "Creates or reuses a Firebase login for this address and assigns Owner on this workspace (same idea as Team → Create login)."
              : "Person who manages this workspace. If they already have an account, they’re linked as Owner immediately. Otherwise the workspace is reserved for that email and self-claims when they sign up."}
          </p>
        </div>

        <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox
              checked={provisionOwnerLogin}
              onCheckedChange={(v) => {
                const on = !!v;
                setProvisionOwnerLogin(on);
                if (!on) {
                  setOwnerDisplayName("");
                  setOwnerPassword("");
                }
              }}
              className="mt-0.5"
              aria-labelledby="provision-owner-label"
            />
            <span className="space-y-1">
              <span
                id="provision-owner-label"
                className="flex items-center gap-2 text-sm font-medium leading-none"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Create owner login now
              </span>
              <span className="block text-xs text-muted-foreground font-normal leading-snug">
                Firebase email/password for the owner, activated immediately. Share the password
                securely out of band; they can change it from the login screen.
              </span>
            </span>
          </label>
          {provisionOwnerLogin && (
            <div className="space-y-3 pt-1 border-t border-border/60">
              <div className="space-y-2">
                <Label htmlFor="owner-display">Owner full name</Label>
                <Input
                  id="owner-display"
                  value={ownerDisplayName}
                  onChange={(e) => setOwnerDisplayName(e.target.value)}
                  placeholder="Jordan Harper"
                  autoComplete="name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="owner-password">Temporary password</Label>
                <Input
                  id="owner-password"
                  type="password"
                  value={ownerPassword}
                  onChange={(e) => setOwnerPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  minLength={8}
                />
              </div>
            </div>
          )}
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
            placeholder="finance@customer.com"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes">Operator notes</Label>
          <Input
            id="notes"
            value={operatorNotes}
            onChange={(e) => setOperatorNotes(e.target.value)}
            placeholder="Internal only"
          />
        </div>
        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className={cn(buttonVariants())}
          >
            {submitting ? "Creating…" : "Create"}
          </button>
          <Link href="/platform/organizations" className={cn(buttonVariants({ variant: "outline" }))}>
            Cancel
          </Link>
        </div>
      </form>

      {created && (
        <div className="rounded-md border bg-card p-4 text-sm">
          <div className="font-medium">
            {created.ownerLoginProvisioned
              ? "Owner login ready"
              : created.ownerLinked
                ? "Owner linked"
                : created.ownerEmail
                  ? "Awaiting owner signup"
                  : "Workspace ready"}
          </div>
          {created.ownerEmail && (
            <p className="mt-1 text-xs text-muted-foreground">
              {created.ownerLoginProvisioned
                ? created.linkedExistingFirebaseUser
                  ? `${created.ownerEmail} already had an account; they’re now Owner here.`
                  : `${created.ownerEmail} can sign in with the password you entered.`
                : created.ownerLinked
                  ? `${created.ownerEmail} is now the owner.`
                  : `${created.ownerEmail} will become the owner the first time they sign up.`}
            </p>
          )}
          {created.ownerLoginProvisioned && (
            <p className="mt-2 text-xs text-muted-foreground">
              No invitation email was sent for this flow, share access details directly if needed.
            </p>
          )}
          {created.setupLink && (
            <div className="mt-3 flex items-center gap-2">
              <Input
                readOnly
                value={created.setupLink}
                className="h-8 text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(created.setupLink!);
                  toast.success("Copied");
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          {created.setupEmailNote && (
            <p className="mt-2 text-xs text-warning">{created.setupEmailNote}</p>
          )}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => router.push(`/platform/organizations/${created.id}`)}
              className={cn(buttonVariants({ size: "sm" }))}
            >
              Open
            </button>
            <button
              type="button"
              onClick={() => {
                setName("");
                setSlug("");
                setOwnerEmail("");
                setMaxUsers("");
                setBillingEmail("");
                setOperatorNotes("");
                setProvisionOwnerLogin(false);
                setOwnerDisplayName("");
                setOwnerPassword("");
                setCreated(null);
              }}
              className={cn(buttonVariants({ size: "sm", variant: "ghost" }))}
            >
              Create another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
