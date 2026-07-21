"use client";

import { useParams } from "next/navigation";
import { TeamDetailView } from "./department-detail-view";

export default function AdminTeamDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  return <TeamDetailView teamId={id} />;
}
