"use client";

import { useParams } from "next/navigation";
import { OrgDetailClient } from "./org-detail-client";

export default function EditOrganizationPage() {
  const params = useParams();
  const orgId = String(params.orgId ?? "");
  return <OrgDetailClient orgId={orgId} />;
}
