"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { CheckCircle2, Copy, Mail } from "lucide-react";
import { slugifyOrganizationName } from "@/lib/platform/slug";

type CreateResponse = {
  id?: string;
  slug?: string;
  ownerLinked?: boolean;
  ownerEmail?: string | null;
  setupLink?: string | null;
  setupEmailDelivered?: boolean;
  setupEmailNote?: string;
  error?: unknown;
};

const STATUS_HINTS: Record<"trial" | "active" | "suspended" | "archived", string> = {
  trial: "Limited access during evaluation.",
  active: "Full access for paying or approved tenants.",
  suspended: "Blocks sign-in and API access until reactivated.",
  archived: "Soft-deleted tenant — use for cleanup, not new customers.",
};

const PLAN_HINTS: Record<"free" | "pro" | "enterprise", string> = {
  free: "Default limits and features.",
  pro: "Higher limits and premium features.",
  enterprise: "Custom limits and support tier.",
};

export default function NewOrganizationPage() {
  const router = useRouter();
  const successRef = React.useRef<HTMLDivElement>(null);

  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [ownerEmail, setOwnerEmail] = React.useState("");
  const [status, setStatus] = React.useState<"trial" | "active" | "suspended" | "archived">("trial");
  const [planId, setPlanId] = React.useState<"free" | "pro" | "enterprise">("free");
  const [maxUsers, setMaxUsers] = React.useState("");
  const [billingEmail, setBillingEmail] = React.useState("");
  const [operatorNotes, setOperatorNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [created, setCreated] = React.useState<CreateResponse | null>(null);

  const resolvedSlug = slug.trim() || slugifyOrganizationName(name);

  React.useEffect(() => {
    if (created) {
      successRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [created]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setCreated(null);
    try {
      const trimmedOwnerEmail = ownerEmail.trim();
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
      toast.success(
        data.ownerLinked
          ? "Organization created and owner linked"
          : data.ownerEmail
            ? data.setupEmailDelivered
              ? "Organization created — owner invite email sent"
              : "Organization created — share the setup link with the owner"
            : "Organization created",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setName("");
    setSlug("");
    setSlugTouched(false);
    setOwnerEmail("");
    setMaxUsers("");
    setBillingEmail("");
    setOperatorNotes("");
    setCreated(null);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/platform/organizations"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Organizations
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">New organization</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a tenant workspace. CRM data is isolated by{" "}
          <code className="rounded bg-muted px-1 text-xs">organizationId</code> in PostgreSQL.
        </p>
      </div>

      {created && (
        <Alert ref={successRef} className="border-success/30 bg-success/5">
          <CheckCircle2 className="text-success" />
          <AlertTitle>
            {created.ownerLinked
              ? "Owner linked"
              : created.ownerEmail
                ? "Awaiting owner sign-up"
                : "Workspace created"}
          </AlertTitle>
          <AlertDescription className="space-y-3">
            {created.ownerEmail ? (
              <p>
                {created.ownerLinked
                  ? `${created.ownerEmail} is now the owner and can sign in at /sign-in.`
                  : `${created.ownerEmail} will become owner when they create a Clerk account with this email.`}
              </p>
            ) : (
              <p>
                No owner was assigned. You can invite someone from the organization settings later.
              </p>
            )}
            {created.setupLink && (
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={created.setupLink}
                  className="h-8 font-mono text-xs"
                  aria-label="Owner setup link"
                />
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(created.setupLink!);
                    toast.success("Link copied");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span className="sr-only">Copy link</span>
                </Button>
              </div>
            )}
            {created.setupEmailNote && (
              <p className="text-warning">{created.setupEmailNote}</p>
            )}
            {!created.setupEmailDelivered && created.setupLink && created.ownerEmail && (
              <p className="flex items-start gap-2 text-xs">
                <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Email was not sent automatically — copy the link above and share it securely.
              </p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                onClick={() => router.push(`/platform/organizations/${created.id}`)}
              >
                Open organization
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={resetForm}>
                Create another
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>Name and URL identifier for this tenant.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Display name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={Boolean(created)}
                placeholder="Acme Corp"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">URL slug</Label>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
                disabled={Boolean(created)}
                placeholder="acme-corp"
              />
              <p className="text-xs text-muted-foreground">
                {slugTouched && slug.trim()
                  ? `Used in URLs and references as ${resolvedSlug}.`
                  : name.trim()
                    ? `Auto-generated: ${resolvedSlug}`
                    : "Leave blank to generate from the display name."}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Owner</CardTitle>
            <CardDescription>
              Optional. Assign who manages this workspace — they sign in via Clerk.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="owner">Owner email</Label>
            <Input
              id="owner"
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              disabled={Boolean(created)}
              placeholder="founder@acme.com"
              autoComplete="email"
            />
            <p className="text-xs text-muted-foreground">
              If they already have a Clerk account, they&apos;re linked as Owner immediately.
              Otherwise the workspace is reserved for that email and an invite link is prepared
              when email delivery is configured.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Plan & billing</CardTitle>
            <CardDescription>Access tier and internal operator metadata.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  value={status}
                  onValueChange={(v) => setStatus(v as typeof status)}
                  disabled={Boolean(created)}
                >
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trial">Trial</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{STATUS_HINTS[status]}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan">Plan</Label>
                <Select
                  value={planId}
                  onValueChange={(v) => setPlanId(v as typeof planId)}
                  disabled={Boolean(created)}
                >
                  <SelectTrigger id="plan">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Free</SelectItem>
                    <SelectItem value="pro">Pro</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{PLAN_HINTS[planId]}</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxUsers">Max users</Label>
              <Input
                id="maxUsers"
                inputMode="numeric"
                value={maxUsers}
                onChange={(e) => setMaxUsers(e.target.value.replace(/\D/g, ""))}
                disabled={Boolean(created)}
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
                disabled={Boolean(created)}
                placeholder="finance@customer.com"
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Operator notes</Label>
              <Textarea
                id="notes"
                value={operatorNotes}
                onChange={(e) => setOperatorNotes(e.target.value)}
                disabled={Boolean(created)}
                placeholder="Internal context — not visible to the tenant."
                rows={3}
                className="resize-y min-h-[4.5rem]"
              />
            </div>
          </CardContent>
        </Card>

        {!created && (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? "Creating…" : "Create organization"}
            </Button>
            <Link href="/platform/organizations" className={cn(buttonVariants({ variant: "outline" }))}>
              Cancel
            </Link>
          </div>
        )}
      </form>
    </div>
  );
}
