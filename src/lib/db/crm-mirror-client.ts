/**
 * Client helper: after a successful Firestore CRM write, ask the server to
 * mirror into Postgres when `POSTGRES_DUAL_WRITE_CRM_V1` is on (server-side).
 */
import type { CrmEntity } from "@/lib/db/dual-write-crm";

export function scheduleCrmMirrorClient(
  entity: CrmEntity,
  id: string,
  action: "upsert" | "delete" = "upsert",
): void {
  if (typeof window === "undefined") return;
  void fetch("/api/org/crm-mirror", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entity, id, action }),
    credentials: "same-origin",
  }).catch((err) => {
    console.error("[crm-mirror] schedule failed", entity, id, err);
  });
}
