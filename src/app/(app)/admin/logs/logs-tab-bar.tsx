"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { adminSubSectionTabs } from "@/lib/admin-sections";

export type LogsTab = "activity" | "errors";

export function useLogsTab(): [LogsTab, (tab: LogsTab) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tab: LogsTab =
    searchParams.get("tab") === "errors" ? "errors" : "activity";

  const setTab = React.useCallback(
    (next: LogsTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "errors") {
        params.set("tab", "errors");
      } else {
        params.delete("tab");
      }
      // Drop pagination noise when switching
      params.delete("page");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router, searchParams],
  );

  React.useEffect(() => {
    const raw = searchParams.get("tab");
    if (raw && !adminSubSectionTabs("/admin/logs").includes(raw) && raw !== "activity") {
      setTab("activity");
    }
  }, [searchParams, setTab]);

  return [tab, setTab];
}

export function LogsTabBar({ value }: { value: LogsTab }) {
  const [, setTab] = useLogsTab();
  return (
    <Tabs
      value={value}
      onValueChange={(v) => setTab(v === "errors" ? "errors" : "activity")}
      className="w-full"
    >
      <TabsList>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="errors">Error logs</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
