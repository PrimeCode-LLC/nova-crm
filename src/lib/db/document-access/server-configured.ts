import { isDatabaseConfigured } from "@/lib/db/prisma";

export function isFirebaseServerConfigured(): boolean {
  return isDatabaseConfigured();
}

/** @deprecated Firebase web removed — always false. */
export function isFirebaseWebConfiguredServer(): boolean {
  return false;
}
