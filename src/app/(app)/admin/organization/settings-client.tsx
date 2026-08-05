"use client";

import * as React from "react";
import { Info, Loader2, Link2, Copy, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OrgEmailSendPolicy, OrgMemberRole } from "@/lib/types";
import { WorkspaceTimezoneField } from "@/components/settings/workspace-timezone-field";
import {
  emptySendPolicyDraft,
  OrgSendPolicyFields,
} from "@/components/settings/org-send-policy-settings";
import { resolveOrgSendPolicy } from "@/lib/email/org-send-policy";
import { clearLegacyAccountTimezone } from "@/lib/scheduling/workspace-timezone";

type OrganizationSettingsPayload = {
  id: string;
  name: string;
  slug: string;
  planId: string;
  seatsUsed: number;
  maxUsers: number | null;
  primaryEmail: string | null;
  billingEmail: string;
  /** Sticky IANA zone, or "" for browser fallback. */
  timezone: string;
  sendPolicy: OrgEmailSendPolicy;
  updatedAt: string;
} | null;

export function OrganizationSettingsClient({
  organization,
  role,
}: {
  organization: OrganizationSettingsPayload;
  role: OrgMemberRole;
}) {
  const router = useRouter();
  const canEdit = role === "owner" || role === "admin";

  const [name, setName] = React.useState(organization?.name ?? "");
  const [billingEmail, setBillingEmail] = React.useState(
    organization?.billingEmail ?? "",
  );
  const [timezone, setTimezone] = React.useState(organization?.timezone ?? "");
  const [sendPolicy, setSendPolicy] = React.useState<OrgEmailSendPolicy>(
    organization?.sendPolicy ?? emptySendPolicyDraft(),
  );
  const [submitting, setSubmitting] = React.useState(false);

  const [joinConfigured, setJoinConfigured] = React.useState(false);
  const [joinUrl, setJoinUrl] = React.useState<string | null>(null);
  const [joinBusy, setJoinBusy] = React.useState(false);
  React.useEffect(() => {
    if (!canEdit || !organization) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/org/join-link", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { configured?: boolean };
        if (!cancelled) setJoinConfigured(Boolean(data.configured));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canEdit, organization?.id]);

  React.useEffect(() => {
    if (!organization) return;
    setName(organization.name);
    setBillingEmail(organization.billingEmail);
    setTimezone(organization.timezone);
    setSendPolicy(resolveOrgSendPolicy(organization.sendPolicy));
  }, [organization?.id, organization?.updatedAt]);

  const seatLabel =
    organization?.maxUsers != null
      ? `${organization.seatsUsed}/${organization.maxUsers} seats`
      : `${organization?.seatsUsed ?? 0} seats`;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!organization || !canEdit) return;

    const payload: {
      name?: string;
      settings?: {
        billingEmail?: string;
        timezone?: string;
        sendPolicy?: OrgEmailSendPolicy;
      };
    } = {};
    if (name.trim() !== organization.name) {
      payload.name = name.trim();
    }
    const nextBilling = billingEmail.trim();
    const prevBilling = (organization.billingEmail ?? "").trim();
    const nextTimezone = timezone.trim();
    const prevTimezone = (organization.timezone ?? "").trim();
    const nextPolicy = resolveOrgSendPolicy({ ...sendPolicy, weekdayOnly: true });
    const prevPolicy = resolveOrgSendPolicy(organization.sendPolicy);
    const settings: {
      billingEmail?: string;
      timezone?: string;
      sendPolicy?: OrgEmailSendPolicy;
    } = {};
    if (nextBilling !== prevBilling) {
      settings.billingEmail = nextBilling;
    }
    if (nextTimezone !== prevTimezone) {
      settings.timezone = nextTimezone;
    }
    if (JSON.stringify(nextPolicy) !== JSON.stringify(prevPolicy)) {
      settings.sendPolicy = nextPolicy;
    }
    if (Object.keys(settings).length > 0) {
      payload.settings = settings;
    }

    if (Object.keys(payload).length === 0) {
      toast.message("No changes to save.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/org/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: unknown; ok?: boolean };
      if (!res.ok) {
        const msg =
          typeof data.error === "string"
            ? data.error
            : JSON.stringify(data.error ?? "Update failed");
        throw new Error(msg);
      }
      toast.success("Organization settings saved.");
      clearLegacyAccountTimezone();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  async function createOrRotateJoinLink() {
    if (!canEdit) return;
    setJoinBusy(true);
    try {
      const res = await fetch("/api/org/join-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rotate" }),
      });
      const data = (await res.json()) as { signupUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not create link");
      if (data.signupUrl) {
        setJoinUrl(data.signupUrl);
        setJoinConfigured(true);
        toast.success("Join link ready, copy it below.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setJoinBusy(false);
    }
  }

  async function clearJoinLink() {
    if (!canEdit) return;
    if (!confirm("Remove the join link? Existing shared URLs will stop working.")) return;
    setJoinBusy(true);
    try {
      const res = await fetch("/api/org/join-link", { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setJoinConfigured(false);
      setJoinUrl(null);
      toast.success("Join link removed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setJoinBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Organization settings"
        description={
          organization
            ? `Timezone, working hours, and billing for ${organization.name}.`
            : "Workspace settings."
        }
      />
      <PageBody>
        {!canEdit && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>View only</AlertTitle>
            <AlertDescription>
              Only workspace owners and admins can change organization details. Contact
              an admin if you need an update.
            </AlertDescription>
          </Alert>
        )}

        {organization && (
          <Card className="border-dashed">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Workspace</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Slug
                </div>
                <div className="mt-1 font-mono text-xs">{organization.slug}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Plan
                </div>
                <div className="mt-1 capitalize">{organization.planId}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Seats
                </div>
                <div className="mt-1">{seatLabel}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Primary email
                </div>
                <div className="mt-1 truncate">
                  {organization.primaryEmail ?? "-"}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Editable fields</CardTitle>
            <p className="text-sm text-muted-foreground">
              Workspace display name, billing contact, timezone, and email send hours.
            </p>
          </CardHeader>
          <CardContent>
            {!organization ? (
              <p className="text-sm text-muted-foreground">
                No workspace loaded. Complete onboarding or sign in again.
              </p>
            ) : (
              <form onSubmit={(e) => void onSubmit(e)} className="max-w-xl space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs" htmlFor="org-name">
                    Workspace name
                  </Label>
                  <Input
                    id="org-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={!canEdit}
                    readOnly={!canEdit}
                    autoComplete="organization"
                  />
                  <p className="text-xs text-muted-foreground">
                    Shown across the app wherever your workspace is identified.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" htmlFor="org-billing-email">
                    Billing email
                  </Label>
                  <Input
                    id="org-billing-email"
                    type="email"
                    value={billingEmail}
                    onChange={(e) => setBillingEmail(e.target.value)}
                    disabled={!canEdit}
                    readOnly={!canEdit}
                    placeholder="billing@company.com"
                    autoComplete="email"
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional. Used for invoices and billing correspondence for this
                    workspace.
                  </p>
                </div>
                <WorkspaceTimezoneField
                  id="org-timezone"
                  label="Workspace timezone"
                  value={timezone}
                  onChange={setTimezone}
                  disabled={!canEdit}
                />
                <OrgSendPolicyFields
                  value={sendPolicy}
                  onChange={setSendPolicy}
                  disabled={!canEdit}
                />
                {canEdit && (
                  <div className="pt-1">
                    <Button type="submit" disabled={submitting}>
                      {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                      Save changes
                    </Button>
                  </div>
                )}
              </form>
            )}
          </CardContent>
        </Card>

        {organization && canEdit && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Link2 className="h-4 w-4" />
                Self-service join link
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Only owners and admins see this. Share one link with your team: they sign up, then
                appear under Team → Pending requests until you approve them.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {joinConfigured && !joinUrl && (
                <p className="text-xs text-muted-foreground">
                  A join link is active. Rotating generates a new URL and invalidates the previous one.
                  The full URL is only shown right after you create or rotate it, for security it is
                  not stored in the browser.
                </p>
              )}
              {joinUrl && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Signup URL</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={joinUrl} className="h-9 font-mono text-xs" />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => {
                        void navigator.clipboard.writeText(joinUrl);
                        toast.success("Copied");
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={joinBusy}
                  onClick={() => void createOrRotateJoinLink()}
                >
                  {joinBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                  <RefreshCw className="h-4 w-4" />
                  {joinConfigured ? "Rotate link" : "Generate link"}
                </Button>
                {joinConfigured && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={joinBusy}
                    onClick={() => void clearJoinLink()}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                    Disable link
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </PageBody>
    </>
  );
}
