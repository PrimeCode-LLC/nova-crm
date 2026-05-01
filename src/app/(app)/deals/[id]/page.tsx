"use client";

import { useParams } from "next/navigation";
import { DealDetailView } from "./deal-detail-view";

export default function DealDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  return <DealDetailView dealId={id} />;
}
