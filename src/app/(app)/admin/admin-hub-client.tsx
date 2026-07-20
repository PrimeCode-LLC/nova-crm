"use client";

import * as React from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  clusterConfigurationItems,
  getVisibleNavSections,
  type NavItem,
} from "@/lib/nav";
import { useNavAccessContext } from "@/lib/hooks/use-nav-access-context";
import { ADMIN_FEATURE_BY_HREF, ADMIN_FEATURES } from "@/lib/admin-features";
import { ADMIN_SUBSECTIONS, adminSubSectionHref } from "@/lib/admin-sections";

/** Human descriptions for items that have no admin-feature entry (e.g. personal Settings). */
const FALLBACK_DESCRIPTIONS: Record<string, string> = {
  "/settings": "Your profile, notifications, integrations, appearance, and billing.",
};

function describe(href: string): string {
  const key = ADMIN_FEATURE_BY_HREF[href];
  if (key) return ADMIN_FEATURES[key].description;
  return FALLBACK_DESCRIPTIONS[href] ?? "";
}

function itemMatches(item: NavItem, q: string): boolean {
  if (!q) return true;
  const subs = ADMIN_SUBSECTIONS[item.href] ?? [];
  const haystack = [
    item.label,
    describe(item.href),
    ...subs.flatMap((s) => [s.label, ...(s.keywords ?? [])]),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q.toLowerCase());
}

export function AdminHubClient() {
  const navAccess = useNavAccessContext();
  const [query, setQuery] = React.useState("");

  const clusters = React.useMemo(() => {
    const sections = getVisibleNavSections(navAccess);
    const config = sections.find((s) => s.label === "Configuration");
    if (!config) return [];
    return clusterConfigurationItems(config.items)
      .map((cluster) => ({
        ...cluster,
        items: cluster.items.filter((item) => itemMatches(item, query)),
      }))
      .filter((cluster) => cluster.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    navAccess.roleId,
    navAccess.orgRole,
    navAccess.isSuperAdmin,
    navAccess.roleLoading,
    navAccess.featureGrants,
    query,
  ]);

  return (
    <>
      <PageHeader
        title="Configuration"
        description="Every workspace setting in one place. Search or browse by area."
        actions={
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settings…"
              className="pl-8"
              aria-label="Search settings"
            />
          </div>
        }
      />
      <PageBody>
        {clusters.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No settings match “{query}”.
          </p>
        ) : (
          clusters.map((cluster) => (
            <section key={cluster.clusterId} className="space-y-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {cluster.label}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {cluster.items.map((item) => {
                  const Icon = item.icon;
                  const subs = ADMIN_SUBSECTIONS[item.href] ?? [];
                  const desc = describe(item.href);
                  return (
                    <Card
                      key={item.href}
                      className="group relative flex h-full flex-col transition-colors hover:border-primary/40"
                    >
                      <CardHeader className="gap-2">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground group-hover:text-foreground">
                            <Icon className="h-4 w-4" />
                          </span>
                          <CardTitle className="text-sm">
                            <Link
                              href={item.href}
                              className="after:absolute after:inset-0 focus-visible:outline-none"
                            >
                              {item.label}
                            </Link>
                          </CardTitle>
                        </div>
                        {desc && (
                          <CardDescription className="text-xs leading-relaxed">
                            {desc}
                          </CardDescription>
                        )}
                      </CardHeader>
                      {subs.length > 0 && (
                        <CardContent className="mt-auto">
                          <div className="relative z-10 flex flex-wrap gap-1.5">
                            {subs.map((s) => (
                              <Link
                                key={s.tab}
                                href={adminSubSectionHref(item.href, s.tab)}
                              >
                                <Badge
                                  variant="secondary"
                                  className="cursor-pointer font-normal hover:bg-secondary/70"
                                >
                                  {s.label}
                                </Badge>
                              </Link>
                            ))}
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </PageBody>
    </>
  );
}
