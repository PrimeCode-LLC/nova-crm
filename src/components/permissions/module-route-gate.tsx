"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { buttonVariants } from "@/components/ui/button";
import { useNavAccessContext } from "@/lib/hooks/use-nav-access-context";
import { MODULE_BY_HREF, MODULE_META } from "@/lib/permissions/catalog";
import { canAccessHref } from "@/lib/permissions/can";
import { resolveModuleHrefForPath } from "@/lib/permissions/resolve-module-href";
import type { ModuleKey } from "@/lib/permissions/catalog";

/**
 * Blocks deep-links to modules the viewer cannot access (content_team → /leads, etc.).
 * Uses the same module catalog as nav — works in demo via system role presets.
 */
export function ModuleRouteGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const ctx = useNavAccessContext();
  const moduleHref = resolveModuleHrefForPath(pathname);

  if (!moduleHref) return <>{children}</>;

  const subject = {
    roleId: ctx.roleId ?? "salesperson",
    isSuperAdmin: ctx.isSuperAdmin,
    featureGrants: ctx.featureGrants,
    orgRole: ctx.orgRole,
    roleSnapshot: ctx.roleSnapshot,
  };

  if (ctx.roleLoading && !canAccessHref(subject, moduleHref)) {
    return (
      <PageBody>
        <p className="text-sm text-muted-foreground">Loading access…</p>
      </PageBody>
    );
  }

  if (canAccessHref(subject, moduleHref)) {
    return <>{children}</>;
  }

  const moduleKey = MODULE_BY_HREF[moduleHref] as ModuleKey | undefined;
  const label = moduleKey ? MODULE_META[moduleKey]?.label ?? "This area" : "This area";

  return (
    <>
      <PageHeader title={label} description="You do not have access to this area." />
      <PageBody className="max-w-md space-y-3">
        <p className="text-sm text-muted-foreground">
          Your role does not include{" "}
          <span className="font-medium text-foreground">{label}</span>. Ask a workspace admin if you
          need access.
        </p>
        <Link href="/dashboard" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to dashboard
        </Link>
      </PageBody>
    </>
  );
}
