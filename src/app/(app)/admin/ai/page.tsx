import { Suspense } from "react";
import { AiAdminClient } from "./ai-admin-client";

export default function AdminAiPage() {
  return (
    <Suspense fallback={null}>
      <AiAdminClient />
    </Suspense>
  );
}
