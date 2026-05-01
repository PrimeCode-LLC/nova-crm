"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { LeadDetailView } from "./lead-detail-view";

export default function LeadDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
      <LeadDetailView leadId={id} />
    </Suspense>
  );
}
