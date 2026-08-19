import type { Firestore } from "@/lib/db/document-shim/shim-firestore";
import { COLLECTIONS } from "@/lib/documents/collections";
import {
  mapProspectingStrategy,
  mapStrategyAssignment,
} from "@/lib/prospecting-strategy/map-docs";
import { activeAssignmentsForUser } from "@/lib/prospecting-strategy/allocation";

export type ExtensionStrategyAttributionInput = {
  strategyId: string;
  strategyName: string;
  strategyVersion: number;
  strategyAssignmentId: string;
  personaId?: string;
  score: number;
  matchedSignalIds?: string[];
  selectionMode?: "auto" | "manual";
};

export type ValidatedExtensionStrategyAttribution = {
  strategyId: string;
  strategyName: string;
  strategyVersion: number;
  strategyAssignmentId: string;
  personaId?: string;
  score: number;
  matchedSignalIds?: string[];
  selectionMode: "auto" | "manual";
};

export class StrategyAttributionError extends Error {}

export async function validateExtensionStrategyAttribution(input: {
  db: Firestore;
  organizationId: string;
  userId: string;
  strategy: ExtensionStrategyAttributionInput | undefined;
}): Promise<ValidatedExtensionStrategyAttribution | undefined> {
  if (!input.strategy) return undefined;
  const [assignmentSnap, strategySnap] = await Promise.all([
    input.db
      .collection(COLLECTIONS.strategyAssignments)
      .doc(input.strategy.strategyAssignmentId)
      .get(),
    input.db
      .collection(COLLECTIONS.prospectingStrategies)
      .doc(input.strategy.strategyId)
      .get(),
  ]);
  if (!assignmentSnap.exists || !strategySnap.exists) {
    throw new StrategyAttributionError("The selected strategy assignment no longer exists.");
  }
  const assignment = mapStrategyAssignment(
    assignmentSnap.id,
    assignmentSnap.data() as Record<string, unknown>,
  );
  const strategy = mapProspectingStrategy(
    strategySnap.id,
    strategySnap.data() as Record<string, unknown>,
  );
  const assignmentActive = activeAssignmentsForUser([assignment], input.userId).length === 1;
  if (
    assignment.organizationId !== input.organizationId ||
    strategy.organizationId !== input.organizationId ||
    assignment.userId !== input.userId ||
    assignment.strategyId !== strategy.id ||
    !assignmentActive ||
    strategy.status !== "published"
  ) {
    throw new StrategyAttributionError(
      "The selected strategy is not an active assignment for this user.",
    );
  }
  const allowedPersonaIds = assignment.personaIdsOverride?.length
    ? assignment.personaIdsOverride
    : strategy.personaIds;
  const personaId =
    input.strategy.personaId && allowedPersonaIds.includes(input.strategy.personaId)
      ? input.strategy.personaId
      : undefined;
  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    strategyVersion: strategy.version,
    strategyAssignmentId: assignment.id,
    score: input.strategy.score,
    selectionMode: input.strategy.selectionMode ?? "auto",
    ...(personaId ? { personaId } : {}),
    ...(input.strategy.matchedSignalIds
      ? { matchedSignalIds: input.strategy.matchedSignalIds }
      : {}),
  };
}
