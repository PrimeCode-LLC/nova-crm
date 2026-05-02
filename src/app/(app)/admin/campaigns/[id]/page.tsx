"use client";

import { useParams } from "next/navigation";
import { CampaignDetailView } from "./campaign-detail-view";

export default function AdminCampaignDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  return <CampaignDetailView campaignId={id} />;
}
