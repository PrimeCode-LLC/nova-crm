/**
 * Server helpers for P6.4: when sole-writer is on, CRM entity mutations go to
 * Postgres only (no Firestore write). Callers still write non-CRM FS docs
 * (timeline, org activity, scraper raw status, etc.).
 */

import {
  patchCrmEntityPostgres,
  upsertCrmEntityPostgres,
  upsertLeadGraphPostgres,
} from "@/lib/db/crm-write-postgres";
import type { CrmEntity } from "@/lib/db/crm-types";

export function isCrmSoleWriterActive(): boolean {
  return true;
}

export async function upsertCrmDocSoleWriter(
  organizationId: string,
  entity: CrmEntity,
  id: string,
  doc: Record<string, unknown>,
): Promise<void> {
  const result = await upsertCrmEntityPostgres(organizationId, entity, id, doc);
  if (!result.ok) {
    throw new Error(result.error);
  }
}

export async function patchCrmDocSoleWriter(
  organizationId: string,
  entity: CrmEntity,
  id: string,
  patch: Record<string, unknown>,
  unset: string[] = [],
): Promise<void> {
  const result = await patchCrmEntityPostgres(
    organizationId,
    entity,
    id,
    patch,
    unset,
  );
  if (!result.ok) {
    throw new Error(result.error);
  }
}

export async function upsertLeadGraphSoleWriter(
  organizationId: string,
  input: {
    account: { id: string; doc: Record<string, unknown> };
    contact: { id: string; doc: Record<string, unknown> };
    lead: { id: string; doc: Record<string, unknown> };
  },
): Promise<void> {
  const result = await upsertLeadGraphPostgres(organizationId, input);
  if (!result.ok) {
    throw new Error(result.error);
  }
}
