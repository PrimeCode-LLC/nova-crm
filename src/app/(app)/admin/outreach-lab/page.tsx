import { Suspense } from "react";
import { OutreachLabClient } from "./outreach-lab-client";

export default function OutreachLabPage() {
  return (
    <Suspense fallback={null}>
      <OutreachLabClient />
    </Suspense>
  );
}
