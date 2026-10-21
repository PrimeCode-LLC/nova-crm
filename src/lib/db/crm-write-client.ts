/**
 * Client helper for P6.2 Postgres sole-writer CRM mutations.
 */
import type { CrmEntity } from "@/lib/db/dual-write-crm";

export type CrmWriteClientBody =
  | {
      action: "upsert";
      entity: CrmEntity;
      id: string;
      doc: Record<string, unknown>;
    }
  | {
      action: "patch";
      entity: CrmEntity;
      id: string;
      patch: Record<string, unknown>;
      unset?: string[];
    }
  | {
      action: "delete";
      entity: CrmEntity;
      id: string;
      accountId?: string;
      accountLeadCount?: number;
    }
  | {
      action: "upsert_graph";
      account: { id: string; doc: Record<string, unknown> };
      contact: { id: string; doc: Record<string, unknown> };
      lead: { id: string; doc: Record<string, unknown> };
    }
  | {
      action: "bump_lead_activity";
      id: string;
    };

export async function persistCrmWriteClient(body: CrmWriteClientBody): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("persistCrmWriteClient is browser-only");
  }
  const res = await fetch("/api/org/crm-write", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `CRM write failed (${res.status})`);
  }
  notifyCrmWrite(body);
}

/** Window event fired after a successful CRM write (QA 3.1). */
export const CRM_WRITE_EVENT = "nova:crm-write";

export type CrmWriteEventDetail = { entities: CrmEntity[]; created: boolean };

function notifyCrmWrite(body: CrmWriteClientBody): void {
  if (body.action === "bump_lead_activity") return;
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  const detail: CrmWriteEventDetail =
    body.action === "upsert_graph"
      ? { entities: ["account", "contact", "lead"], created: true }
      : { entities: [body.entity], created: body.action !== "patch" };
  window.dispatchEvent(new CustomEvent<CrmWriteEventDetail>(CRM_WRITE_EVENT, { detail }));
}
