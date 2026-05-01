"use client";

import { useParams } from "next/navigation";
import { AccountDetailView } from "./account-detail-view";

export default function AccountDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  return <AccountDetailView accountId={id} />;
}
