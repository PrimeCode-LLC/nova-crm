"use client";

import { useParams } from "next/navigation";
import { OutreachCampaignDetail } from "@/components/outreach/outreach-campaign-detail";

export default function OutreachCampaignPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  return <OutreachCampaignDetail campaignId={id} />;
}
