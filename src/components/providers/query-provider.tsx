"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { CRM_WRITE_EVENT, type CrmWriteEventDetail } from "@/lib/db/crm-write-client";

const ReactQueryDevtools = dynamic(
  () =>
    import("@tanstack/react-query-devtools").then((m) => m.ReactQueryDevtools),
  { ssr: false },
);

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  // Lists and counts are cached for 30s; refresh the affected ones as soon as
  // this tab creates, edits or deletes a CRM record (QA 3.1 — new prospects
  // missing from the list until a reload).
  React.useEffect(() => {
    const onWrite = (event: Event) => {
      const detail = (event as CustomEvent<CrmWriteEventDetail>).detail;
      if (!detail) return;
      for (const entity of detail.entities) {
        void client.invalidateQueries({ queryKey: ["org", "crm-pages", `${entity}s`] });
      }
      void client.invalidateQueries({ queryKey: ["org", "crm-counts"] });
    };
    window.addEventListener(CRM_WRITE_EVENT, onWrite);
    return () => window.removeEventListener(CRM_WRITE_EVENT, onWrite);
  }, [client]);

  return (
    <QueryClientProvider client={client}>
      {children}
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
      )}
    </QueryClientProvider>
  );
}
