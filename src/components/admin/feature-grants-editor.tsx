"use client";

import * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  ADMIN_FEATURES,
  grantableFeaturesByCluster,
  type AdminFeatureKey,
} from "@/lib/admin-features";
import { userHasAdminFeature } from "@/lib/admin-feature-access";
import type { Role, User } from "@/lib/types";
import { cn } from "@/lib/utils";

export function FeatureGrantsEditor({
  user,
  value,
  onChange,
  disabled,
}: {
  user: Pick<User, "roleId" | "orgRole" | "isSuperAdmin">;
  value: AdminFeatureKey[];
  onChange: (next: AdminFeatureKey[]) => void;
  disabled?: boolean;
}) {
  const granted = new Set(value);

  function toggle(key: AdminFeatureKey, checked: boolean) {
    const next = new Set(granted);
    if (checked) next.add(key);
    else next.delete(key);
    onChange([...next]);
  }

  const groups = grantableFeaturesByCluster();

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Grant specific admin tools without changing this person&apos;s CRM role. Role-based access
        still applies — grants only add capabilities they would not have otherwise.
      </p>
      {groups.map((group) => (
        <div key={group.cluster} className="space-y-2">
          <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
            {group.label}
          </p>
          <div className="space-y-2 rounded-md border border-border/60 p-3">
            {group.features.map((key) => {
              const meta = ADMIN_FEATURES[key];
              const hasViaRole = roleOnlyHasFeature(user, key);
              const checked = granted.has(key);
              const roleLabel = meta.minWorkspaceRole
                ? meta.minWorkspaceRole.replace("_", " ")
                : meta.minOrgRole;

              return (
                <div
                  key={key}
                  className={cn(
                    "flex items-start gap-3",
                    hasViaRole && !checked && "opacity-60",
                  )}
                >
                  <Checkbox
                    id={`fg-${key}`}
                    checked={checked || hasViaRole}
                    disabled={disabled || hasViaRole}
                    onCheckedChange={(v) => toggle(key, v === true)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <Label htmlFor={`fg-${key}`} className="text-sm font-medium leading-tight">
                      {meta.label}
                    </Label>
                    <p className="text-xs text-muted-foreground">{meta.description}</p>
                    {hasViaRole ? (
                      <p className="text-[0.65rem] text-muted-foreground mt-0.5">
                        Already allowed via {roleLabel ?? "role"}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function roleOnlyHasFeature(
  user: Pick<User, "roleId" | "orgRole" | "isSuperAdmin">,
  key: AdminFeatureKey,
): boolean {
  return userHasAdminFeature(
    { roleId: user.roleId, isSuperAdmin: user.isSuperAdmin, orgRole: user.orgRole },
    key,
    user.orgRole,
  );
}

export function featureGrantsSummary(
  user: Pick<User, "roleId" | "orgRole" | "isSuperAdmin" | "featureGrants">,
): string {
  const grants = user.featureGrants ?? [];
  const extra = grants.filter((k) => !roleOnlyHasFeature(user, k));
  if (!extra.length) return "—";
  return extra.map((k) => ADMIN_FEATURES[k].label).join(", ");
}
