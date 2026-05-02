"use client";

import * as React from "react";
import { Info, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OrgMemberRole } from "@/lib/types";

type OrganizationSettingsPayload = {
  id: string;
  name: string;
  slug: string;
  planId: string;
  seatsUsed: number;
  maxUsers: number | null;
  primaryEmail: string | null;
  billingEmail: string;
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
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!organization) return;
    setName(organization.name);
    setBillingEmail(organization.billingEmail);
  }, [organization?.id, organization?.updatedAt]);

  const seatLabel =
    organization?.maxUsers != null
      ? `${organization.seatsUsed}/${organization.maxUsers} seats`
      : `${organization?.seatsUsed ?? 0} seats`;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!organization || !canEdit) return;

    const payload: { name?: string; settings?: { billingEmail: string } } = {};
    if (name.trim() !== organization.name) {
      payload.name = name.trim();
    }
    const nextBilling = billingEmail.trim();
    const prevBilling = (organization.billingEmail ?? "").trim();
    if (nextBilling !== prevBilling) {
      payload.settings = { billingEmail: nextBilling };
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
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Organization settings"
        description={
          organization
            ? `Display and billing preferences for ${organization.name}.`
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
                  {organization.primaryEmail ?? "—"}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Editable fields</CardTitle>
            <p className="text-sm text-muted-foreground">
              Workspace display name and where we send billing-related notices for this
              organization.
            </p>
          </CardHeader>
          <CardContent>
            {!organization ? (
              <p className="text-sm text-muted-foreground">
                No workspace loaded. Complete onboarding or sign in again.
              </p>
            ) : (
              <form onSubmit={(e) => void onSubmit(e)} className="max-w-lg space-y-4">
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
      </PageBody>
    </>
  );
}
