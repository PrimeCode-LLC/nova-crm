import { isDatabaseConfigured } from "@/lib/db/prisma";

export function isDocumentAccessConfigured(): boolean {
  return isDatabaseConfigured();
}

/** @deprecated Firebase web removed — always false. */
export function isClientDocumentSyncEnabledServer(): boolean {
  return false;
}
