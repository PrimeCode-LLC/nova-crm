import { Timestamp } from "@/lib/db/document-shim/shim-client-firestore";

export function documentTimestampToIso(value: unknown): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as Timestamp).toDate === "function"
  ) {
    return (value as Timestamp).toDate().toISOString();
  }
  return new Date().toISOString();
}
