import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import PlatformOrganizationsPage from "./organizations-page-client";

export default function PlatformOrganizationsRoute() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <PlatformOrganizationsPage />
    </Suspense>
  );
}
