import crypto from "node:crypto";
import {
  extensionOptionsResponse,
  guardExtensionApi,
} from "@/lib/extension/auth-server";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  mapBuyerPersona,
  mapProspectingStrategy,
  mapStrategyAssignment,
} from "@/lib/prospecting-strategy/map-docs";
import { activeAssignmentsForUser } from "@/lib/prospecting-strategy/allocation";
import { getOrganizationIntentPlaybookServer } from "@/lib/intent/intent-playbook-server";

export function OPTIONS(req: Request) {
  return extensionOptionsResponse(req);
}

function etagFor(value: unknown): string {
  return `"${crypto.createHash("sha256").update(JSON.stringify(value)).digest("base64url")}"`;
}

export async function GET(req: Request) {
  const guarded = await guardExtensionApi(req);
  if (!guarded.ok) return guarded.response;
  const db = getAdminDb();
  if (!db) {
    return Response.json(
      { error: "Database not configured." },
      { status: 503, headers: guarded.headers },
    );
  }
  const { organizationId, uid } = guarded.principal;
  const [assignmentSnap, strategySnap, personaSnap, playbook] = await Promise.all([
    db
      .collection(COLLECTIONS.strategyAssignments)
      .where("organizationId", "==", organizationId)
      .get(),
    db
      .collection(COLLECTIONS.prospectingStrategies)
      .where("organizationId", "==", organizationId)
      .get(),
    db
      .collection(COLLECTIONS.buyerPersonas)
      .where("organizationId", "==", organizationId)
      .get(),
    getOrganizationIntentPlaybookServer(organizationId),
  ]);

  const assignments = activeAssignmentsForUser(
    assignmentSnap.docs.map((doc) =>
      mapStrategyAssignment(doc.id, doc.data() as Record<string, unknown>),
    ),
    uid,
  );
  const strategyIds = new Set(assignments.map((assignment) => assignment.strategyId));
  const strategies = strategySnap.docs
    .map((doc) =>
      mapProspectingStrategy(doc.id, doc.data() as Record<string, unknown>),
    )
    .filter(
      (strategy) =>
        strategyIds.has(strategy.id) && strategy.status === "published",
    );
  const personaIds = new Set(
    assignments.flatMap((assignment) => assignment.personaIdsOverride ?? []).concat(
      strategies.flatMap((strategy) => strategy.personaIds),
    ),
  );
  const personas = personaSnap.docs
    .map((doc) => mapBuyerPersona(doc.id, doc.data() as Record<string, unknown>))
    .filter((persona) => persona.active && personaIds.has(persona.id));

  const payload = {
    schemaVersion: 1,
    syncedAt: new Date().toISOString(),
    user: {
      id: uid,
      email: guarded.principal.email,
      name: guarded.principal.name,
      organizationId,
      orgRole: guarded.principal.orgRole,
    },
    permissions: {
      canScan: true,
      canSaveIntake: true,
      canCreateProspect: true,
      canAttachProspect: true,
    },
    assignments,
    strategies,
    personas,
    playbook,
    leaseExpiresAt: guarded.leaseExpiresAt,
    sessionExpiresAt: guarded.principal.expiresAt,
  };
  const etag = etagFor({
    assignments: assignments.map((item) => [item.id, item.updatedAt, item.status]),
    strategies: strategies.map((item) => [item.id, item.version, item.updatedAt]),
    personas: personas.map((item) => [item.id, item.updatedAt, item.active]),
    playbookUpdatedAt: playbook.updatedAt ?? null,
  });
  const headers = new Headers(guarded.headers);
  headers.set("ETag", etag);
  headers.set("Cache-Control", "private, no-cache");
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return Response.json({ ...payload, configVersion: etag.slice(1, -1) }, { headers });
}
