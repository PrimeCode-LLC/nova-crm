import { Timestamp } from "firebase/firestore";

export function firestoreValueToIso(value: unknown): string {
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
