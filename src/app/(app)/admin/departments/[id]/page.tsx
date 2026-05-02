"use client";

import { useParams } from "next/navigation";
import { DepartmentDetailView } from "./department-detail-view";

export default function AdminDepartmentDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  return <DepartmentDetailView departmentId={id} />;
}
