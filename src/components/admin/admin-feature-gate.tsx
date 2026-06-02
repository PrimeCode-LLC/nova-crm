"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { buttonVariants } from "@/components/ui/button";
import { useNavAccessContext } from "@/lib/hooks/use-nav-access-context";
import { ADMIN_FEATURE_BY_HREF, ADMIN_FEATURES } from "@/lib/admin-features";
import { userHasAdminFeature } from "@/lib/admin-feature-access";
import type { AdminFeatureKey } from "@/lib/admin-features";

export function AdminFeatureGate({
  feature,
  children,
}: {
  feature: AdminFeatureKey;
  children: React.ReactNode;
}) {
  const ctx = useNavAccessContext();
  const allowed = userHasAdminFeature(
    {
      roleId: ctx.roleId ?? "salesperson",
      isSuperAdmin: ctx.isSuperAdmin,
      featureGrants: ctx.featureGrants,
      orgRole: ctx.orgRole,
    },
    feature,
    ctx.orgRole,
  );

  if (ctx.roleLoading && !allowed) {
    return (
      <PageBody>
        <p className="text-sm text-muted-foreground">Loading access…</p>
      </PageBody>
    );
  }

  if (!allowed) {
    const meta = ADMIN_FEATURES[feature];
    return (
      <>
        <PageHeader title={meta.label} description="You do not have access to this area." />
        <PageBody className="max-w-md space-y-3">
          <p className="text-sm text-muted-foreground">
            Ask a director or workspace admin to grant you the{" "}
            <span className="font-medium text-foreground">{meta.label}</span> feature without
            changing your CRM role.
          </p>
          <Link
            href="/dashboard"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Back to dashboard
          </Link>
        </PageBody>
      </>
    );
  }

  return <>{children}</>;
}

/** Resolves feature from current pathname for admin routes. */
export function AdminRouteFeatureGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const feature = ADMIN_FEATURE_BY_HREF[pathname];
  if (!feature) return <>{children}</>;
  return <AdminFeatureGate feature={feature}>{children}</AdminFeatureGate>;
}
