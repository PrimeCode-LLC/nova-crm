import { Suspense } from "react";
import { OutreachLabDetailClient } from "./detail-client";

export default function OutreachLabDetailPage() {
  return (
    <Suspense fallback={null}>
      <OutreachLabDetailClient />
    </Suspense>
  );
}
