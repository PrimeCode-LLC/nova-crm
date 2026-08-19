import type { RecordAuditInput } from "@/lib/firestore/audit";

export function auditActorEmail(session: { email?: string | null }): string | null {
  const email = session.email?.trim();
  return email || null;
}

export function withAuditActor(
  session: { email?: string | null },
  input: RecordAuditInput,
): RecordAuditInput {
  return {
    ...input,
    actorEmail: input.actorEmail ?? auditActorEmail(session),
  };
}
