import {
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "@/lib/db/document-shim/shim-client-firestore";
import type { Firestore } from "@/lib/db/document-shim/shim-client-firestore";
import { COLLECTIONS } from "@/lib/documents/collections";
import { stripUndefined } from "@/lib/documents/strip-undefined";
import type {
  BuyerPersona,
  ProspectingStrategy,
  StrategyAssignment,
} from "@/lib/prospecting-strategy/types";

export async function persistBuyerPersonaCreate(
  db: Firestore,
  organizationId: string,
  persona: BuyerPersona,
): Promise<void> {
  await setDoc(
    doc(db, COLLECTIONS.buyerPersonas, persona.id),
    stripUndefined({ ...persona, organizationId }) as Record<string, unknown>,
  );
}

export async function persistBuyerPersonaUpdate(
  db: Firestore,
  personaId: string,
  patch: Partial<BuyerPersona>,
): Promise<void> {
  const { id: _id, organizationId: _org, createdAt: _c, createdBy: _by, ...rest } = patch;
  await updateDoc(doc(db, COLLECTIONS.buyerPersonas, personaId), {
    ...stripUndefined(rest as Record<string, unknown>),
    updatedAt: serverTimestamp(),
  });
}

export async function persistBuyerPersonaDelete(db: Firestore, personaId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.buyerPersonas, personaId));
}

export async function persistProspectingStrategyCreate(
  db: Firestore,
  organizationId: string,
  strategy: ProspectingStrategy,
): Promise<void> {
  await setDoc(
    doc(db, COLLECTIONS.prospectingStrategies, strategy.id),
    stripUndefined({ ...strategy, organizationId }) as Record<string, unknown>,
  );
}

export async function persistProspectingStrategyUpdate(
  db: Firestore,
  strategyId: string,
  patch: Partial<ProspectingStrategy>,
): Promise<void> {
  const { id: _id, organizationId: _org, createdAt: _c, createdBy: _by, ...rest } = patch;
  await updateDoc(doc(db, COLLECTIONS.prospectingStrategies, strategyId), {
    ...stripUndefined(rest as Record<string, unknown>),
    updatedAt: serverTimestamp(),
  });
}

export async function persistProspectingStrategyDelete(
  db: Firestore,
  strategyId: string,
): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.prospectingStrategies, strategyId));
}

export async function persistStrategyAssignmentCreate(
  db: Firestore,
  organizationId: string,
  assignment: StrategyAssignment,
): Promise<void> {
  await setDoc(
    doc(db, COLLECTIONS.strategyAssignments, assignment.id),
    stripUndefined({ ...assignment, organizationId }) as Record<string, unknown>,
  );
}

export async function persistStrategyAssignmentUpdate(
  db: Firestore,
  assignmentId: string,
  patch: Partial<StrategyAssignment>,
): Promise<void> {
  const { id: _id, organizationId: _org, createdAt: _c, assignedBy: _by, ...rest } = patch;
  await updateDoc(doc(db, COLLECTIONS.strategyAssignments, assignmentId), {
    ...stripUndefined(rest as Record<string, unknown>),
    updatedAt: serverTimestamp(),
  });
}

export async function persistStrategyAssignmentDelete(
  db: Firestore,
  assignmentId: string,
): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.strategyAssignments, assignmentId));
}

/** Seed personas + master strategy in one batch (dev/setup helper). */
export async function persistProspectingSeedBatch(
  db: Firestore,
  organizationId: string,
  personas: BuyerPersona[],
  strategy: ProspectingStrategy,
): Promise<void> {
  const batch = writeBatch(db);
  for (const p of personas) {
    batch.set(
      doc(db, COLLECTIONS.buyerPersonas, p.id),
      stripUndefined({ ...p, organizationId }) as Record<string, unknown>,
    );
  }
  batch.set(
    doc(db, COLLECTIONS.prospectingStrategies, strategy.id),
    stripUndefined({ ...strategy, organizationId }) as Record<string, unknown>,
  );
  await batch.commit();
}
