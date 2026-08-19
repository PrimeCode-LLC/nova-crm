/** Firestore / gRPC `FAILED_PRECONDITION` (e.g. missing index, index building). */
export function isDocumentQueryFailedPrecondition(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: number | string }).code;
  return code === 9 || code === "failed-precondition";
}
