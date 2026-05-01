"use client";

import { useParams } from "next/navigation";
import { ContactDetailView } from "./contact-detail-view";

export default function ContactDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  return <ContactDetailView contactId={id} />;
}
