"use client";

import * as React from "react";
import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { toast } from "sonner";

import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { getFirebaseDb } from "@/lib/firebase/client";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  mapBuyerPersona,
  mapProspectingStrategy,
  mapStrategyAssignment,
} from "@/lib/prospecting-strategy/map-docs";
import { buildDemoProspectingData } from "@/lib/prospecting-strategy/seed";
import type {
  BuyerPersona,
  ProspectingStrategy,
  StrategyAssignment,
} from "@/lib/prospecting-strategy/types";
import {
  persistBuyerPersonaCreate,
  persistBuyerPersonaDelete,
  persistBuyerPersonaUpdate,
  persistProspectingSeedBatch,
  persistProspectingStrategyCreate,
  persistProspectingStrategyDelete,
  persistProspectingStrategyUpdate,
  persistStrategyAssignmentCreate,
  persistStrategyAssignmentDelete,
  persistStrategyAssignmentUpdate,
} from "@/lib/firestore/persist-prospecting-strategy-client";
import { buildSeedPersonas, buildSeedStrategy } from "@/lib/prospecting-strategy/seed";
import { buildSampleB2bSaasPack } from "@/lib/prospecting-strategy/sample-pack";
import {
  materializeStrategyPack,
  parseStrategyPack,
  strategyToPack,
  type StrategyPack,
} from "@/lib/prospecting-strategy/pack";
import { DEMO_WORKSPACE_ORG_ID } from "@/lib/demo-workspace-ids";
import { createUserNotification, actorLabel } from "@/lib/notifications/create-user-notification";
import { recordStrategyAuditClient } from "@/lib/firestore/audit-change-client";
import type { OrgActivityEvent, OrgActivityEventType } from "@/lib/types";

function newOrgActivityId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `oa-${crypto.randomUUID()}`;
  }
  return `oa-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function emitStrategyOrgActivity(
  ws: {
    currentUserId: string;
    users: { id: string; displayName?: string; email?: string }[];
    addOrgActivityEvent: (e: OrgActivityEvent) => void;
  },
  input: {
    type: OrgActivityEventType;
    summary: string;
    strategyId: string;
    strategyName?: string;
    assigneeId?: string;
    href?: string;
  },
) {
  ws.addOrgActivityEvent({
    id: newOrgActivityId(),
    type: input.type,
    actorId: ws.currentUserId,
    summary: input.summary,
    createdAt: new Date().toISOString(),
    href: input.href ?? "/admin/strategies",
    entityType: "strategy",
    entityId: input.strategyId,
    payload: {
      strategyId: input.strategyId,
      ...(input.strategyName !== undefined ? { strategyName: input.strategyName } : {}),
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
    },
  });
}

async function notifyStrategyAssignment(
  ws: {
    isDemo: boolean;
    currentUserId: string;
    users: { id: string; displayName?: string; email?: string }[];
    organizationId?: string;
    addOrgActivityEvent: (e: OrgActivityEvent) => void;
  },
  organizationId: string,
  assignment: StrategyAssignment,
  strategies: ProspectingStrategy[],
  action: "assigned" | "updated" | "paused" | "activated" | "removed",
) {
  const strategy = strategies.find((s) => s.id === assignment.strategyId);
  const name = strategy?.name?.trim() || "a prospecting strategy";
  const actor = actorLabel(ws.users, ws.currentUserId);
  const pct = assignment.allocationPct;
  let message: string;
  let orgType: OrgActivityEventType;
  let feedSummary: string;
  switch (action) {
    case "assigned":
      message = `${actor} assigned you strategy “${name}” (${pct}%)`;
      feedSummary = `${actor} assigned strategy “${name}” (${pct}%)`;
      orgType = "strategy_assigned";
      break;
    case "updated":
      message = `${actor} updated your assignment on “${name}” (${pct}%)`;
      feedSummary = `${actor} updated strategy assignment on “${name}” (${pct}%)`;
      orgType = "strategy_assignment_updated";
      break;
    case "paused":
      message = `${actor} paused your assignment on “${name}”`;
      feedSummary = `${actor} paused strategy assignment on “${name}”`;
      orgType = "strategy_assignment_paused";
      break;
    case "activated":
      message = `${actor} reactivated your assignment on “${name}”`;
      feedSummary = `${actor} reactivated strategy assignment on “${name}”`;
      orgType = "strategy_assignment_activated";
      break;
    case "removed":
      message = `${actor} removed your assignment on “${name}”`;
      feedSummary = `${actor} removed strategy assignment on “${name}”`;
      orgType = "strategy_assignment_removed";
      break;
  }
  emitStrategyOrgActivity(ws, {
    type: orgType,
    summary: feedSummary,
    strategyId: assignment.strategyId,
    strategyName: name,
    assigneeId: assignment.userId,
    href: "/admin/strategies",
  });
  recordStrategyAuditClient({
    event: "strategy.assigned",
    strategyId: assignment.strategyId,
    strategyName: name,
    action,
    assigneeId: assignment.userId,
  });
  await createUserNotification(
    { organizationId: ws.organizationId || organizationId, isDemo: ws.isDemo },
    {
      organizationId: ws.organizationId || organizationId,
      recipientId: assignment.userId,
      actorId: ws.currentUserId,
      kind: "assignment",
      message,
      target: name,
      targetHref: "/my-strategy",
      entityType: "strategy",
      entityId: assignment.strategyId,
    },
  );
}

export type ProspectingStrategyData = {
  loading: boolean;
  personas: BuyerPersona[];
  strategies: ProspectingStrategy[];
  assignments: StrategyAssignment[];
  organizationId: string;
  addPersona: (persona: BuyerPersona) => Promise<void>;
  updatePersona: (id: string, patch: Partial<BuyerPersona>) => Promise<void>;
  deletePersona: (id: string) => Promise<void>;
  addStrategy: (strategy: ProspectingStrategy) => Promise<void>;
  updateStrategy: (id: string, patch: Partial<ProspectingStrategy>) => Promise<void>;
  deleteStrategy: (id: string) => Promise<void>;
  addAssignment: (assignment: StrategyAssignment) => Promise<void>;
  updateAssignment: (id: string, patch: Partial<StrategyAssignment>) => Promise<void>;
  deleteAssignment: (id: string) => Promise<void>;
  /** Install the neutral product sample pack (safe for any SaaS org). */
  installSamplePack: () => Promise<{ strategyId: string; warnings: string[] }>;
  /** Import a StrategyPack JSON into this org with fresh ids. */
  importStrategyPack: (
    pack: StrategyPack,
  ) => Promise<{ strategyId: string; warnings: string[] }>;
  /** Build a portable pack from a live strategy (for download). */
  exportStrategyPack: (strategyId: string) => StrategyPack | null;
  /**
   * @deprecated Internal/dev only — exports Stellix master into Firestore with fixed ids.
   * Prefer private JSON packs + importStrategyPack.
   */
  seedMasterPack: () => Promise<void>;
};

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

export { newId as newProspectingEntityId };

export function useProspectingStrategyData(): ProspectingStrategyData {
  const ws = useWorkspace();
  const organizationId = ws.isDemo
    ? DEMO_WORKSPACE_ORG_ID
    : ws.organizationId ?? "";
  const canLive =
    !ws.isDemo && isFirebaseWebConfigured() && Boolean(organizationId);

  const [loading, setLoading] = React.useState(canLive);
  const [personas, setPersonas] = React.useState<BuyerPersona[]>([]);
  const [strategies, setStrategies] = React.useState<ProspectingStrategy[]>([]);
  const [assignments, setAssignments] = React.useState<StrategyAssignment[]>([]);

  // Demo / offline local state
  const [demoDelta, setDemoDelta] = React.useState(() =>
    ws.isDemo ? buildDemoProspectingData(ws.currentUserId) : null,
  );

  React.useEffect(() => {
    if (ws.isDemo) {
      setDemoDelta(buildDemoProspectingData(ws.currentUserId));
      setLoading(false);
      return;
    }
    if (!canLive || !organizationId) {
      setPersonas([]);
      setStrategies([]);
      setAssignments([]);
      setLoading(false);
      return;
    }

    const db = getFirebaseDb();
    setLoading(true);
    let pending = 3;
    const done = () => {
      pending -= 1;
      if (pending <= 0) setLoading(false);
    };

    const unsubs = [
      onSnapshot(
        query(
          collection(db, COLLECTIONS.buyerPersonas),
          where("organizationId", "==", organizationId),
        ),
        (snap) => {
          setPersonas(snap.docs.map((d) => mapBuyerPersona(d.id, d.data() as Record<string, unknown>)));
          done();
        },
        (err) => {
          console.error("[prospecting] personas", err);
          toast.error("Could not load buyer personas");
          done();
        },
      ),
      onSnapshot(
        query(
          collection(db, COLLECTIONS.prospectingStrategies),
          where("organizationId", "==", organizationId),
        ),
        (snap) => {
          setStrategies(
            snap.docs.map((d) =>
              mapProspectingStrategy(d.id, d.data() as Record<string, unknown>),
            ),
          );
          done();
        },
        (err) => {
          console.error("[prospecting] strategies", err);
          toast.error("Could not load strategies");
          done();
        },
      ),
      onSnapshot(
        query(
          collection(db, COLLECTIONS.strategyAssignments),
          where("organizationId", "==", organizationId),
        ),
        (snap) => {
          setAssignments(
            snap.docs.map((d) =>
              mapStrategyAssignment(d.id, d.data() as Record<string, unknown>),
            ),
          );
          done();
        },
        (err) => {
          console.error("[prospecting] assignments", err);
          toast.error("Could not load assignments");
          done();
        },
      ),
    ];

    return () => {
      for (const u of unsubs) u();
    };
  }, [ws.isDemo, ws.currentUserId, canLive, organizationId]);

  const livePersonas = ws.isDemo ? (demoDelta?.personas ?? []) : personas;
  const liveStrategies = ws.isDemo ? (demoDelta?.strategies ?? []) : strategies;
  const liveAssignments = ws.isDemo ? (demoDelta?.assignments ?? []) : assignments;

  const addPersona = React.useCallback(
    async (persona: BuyerPersona) => {
      if (ws.isDemo) {
        setDemoDelta((d) =>
          d ? { ...d, personas: [...d.personas.filter((p) => p.id !== persona.id), persona] } : d,
        );
        return;
      }
      if (!canLive) throw new Error("No organization context");
      await persistBuyerPersonaCreate(getFirebaseDb(), organizationId, persona);
    },
    [ws.isDemo, canLive, organizationId],
  );

  const updatePersona = React.useCallback(
    async (id: string, patch: Partial<BuyerPersona>) => {
      if (ws.isDemo) {
        setDemoDelta((d) =>
          d
            ? {
                ...d,
                personas: d.personas.map((p) =>
                  p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p,
                ),
              }
            : d,
        );
        return;
      }
      if (!canLive) throw new Error("No organization context");
      await persistBuyerPersonaUpdate(getFirebaseDb(), id, patch);
    },
    [ws.isDemo, canLive],
  );

  const deletePersona = React.useCallback(
    async (id: string) => {
      if (ws.isDemo) {
        setDemoDelta((d) => (d ? { ...d, personas: d.personas.filter((p) => p.id !== id) } : d));
        return;
      }
      if (!canLive) throw new Error("No organization context");
      await persistBuyerPersonaDelete(getFirebaseDb(), id);
    },
    [ws.isDemo, canLive],
  );

  const addStrategy = React.useCallback(
    async (strategy: ProspectingStrategy) => {
      if (ws.isDemo) {
        setDemoDelta((d) =>
          d
            ? {
                ...d,
                strategies: [...d.strategies.filter((s) => s.id !== strategy.id), strategy],
              }
            : d,
        );
      } else {
        if (!canLive) throw new Error("No organization context");
        await persistProspectingStrategyCreate(getFirebaseDb(), organizationId, strategy);
      }
      const actor = actorLabel(ws.users, ws.currentUserId);
      const name = strategy.name?.trim() || "Untitled strategy";
      emitStrategyOrgActivity(ws, {
        type: "strategy_created",
        summary: `${actor} created strategy “${name}”`,
        strategyId: strategy.id,
        strategyName: name,
      });
      recordStrategyAuditClient({
        event: "strategy.created",
        strategyId: strategy.id,
        strategyName: name,
      });
    },
    [ws, canLive, organizationId],
  );

  const updateStrategy = React.useCallback(
    async (id: string, patch: Partial<ProspectingStrategy>) => {
      const existing = liveStrategies.find((s) => s.id === id);
      if (ws.isDemo) {
        setDemoDelta((d) =>
          d
            ? {
                ...d,
                strategies: d.strategies.map((s) =>
                  s.id === id ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s,
                ),
              }
            : d,
        );
      } else {
        if (!canLive) throw new Error("No organization context");
        await persistProspectingStrategyUpdate(getFirebaseDb(), id, patch);
      }
      const actor = actorLabel(ws.users, ws.currentUserId);
      const name = (patch.name ?? existing?.name)?.trim() || "Untitled strategy";
      emitStrategyOrgActivity(ws, {
        type: "strategy_updated",
        summary: `${actor} updated strategy “${name}”`,
        strategyId: id,
        strategyName: name,
      });
      recordStrategyAuditClient({
        event: "strategy.updated",
        strategyId: id,
        strategyName: name,
      });
    },
    [ws, canLive, liveStrategies],
  );

  const deleteStrategy = React.useCallback(
    async (id: string) => {
      const existing = liveStrategies.find((s) => s.id === id);
      if (ws.isDemo) {
        setDemoDelta((d) =>
          d
            ? {
                ...d,
                strategies: d.strategies.filter((s) => s.id !== id),
                assignments: d.assignments.filter((a) => a.strategyId !== id),
              }
            : d,
        );
      } else {
        if (!canLive) throw new Error("No organization context");
        await persistProspectingStrategyDelete(getFirebaseDb(), id);
      }
      const actor = actorLabel(ws.users, ws.currentUserId);
      const name = existing?.name?.trim() || "a strategy";
      emitStrategyOrgActivity(ws, {
        type: "strategy_deleted",
        summary: `${actor} deleted strategy “${name}”`,
        strategyId: id,
        strategyName: name,
      });
      recordStrategyAuditClient({
        event: "strategy.deleted",
        strategyId: id,
        strategyName: name,
      });
    },
    [ws, canLive, liveStrategies],
  );

  const addAssignment = React.useCallback(
    async (assignment: StrategyAssignment) => {
      if (ws.isDemo) {
        setDemoDelta((d) =>
          d
            ? {
                ...d,
                assignments: [
                  ...d.assignments.filter((a) => a.id !== assignment.id),
                  assignment,
                ],
              }
            : d,
        );
        await notifyStrategyAssignment(
          ws,
          organizationId || DEMO_WORKSPACE_ORG_ID,
          assignment,
          liveStrategies,
          "assigned",
        );
        return;
      }
      if (!canLive) throw new Error("No organization context");
      await persistStrategyAssignmentCreate(getFirebaseDb(), organizationId, assignment);
      await notifyStrategyAssignment(ws, organizationId, assignment, liveStrategies, "assigned");
    },
    [ws, canLive, organizationId, liveStrategies],
  );

  const updateAssignment = React.useCallback(
    async (id: string, patch: Partial<StrategyAssignment>) => {
      const existing = liveAssignments.find((a) => a.id === id);
      if (ws.isDemo) {
        setDemoDelta((d) =>
          d
            ? {
                ...d,
                assignments: d.assignments.map((a) =>
                  a.id === id ? { ...a, ...patch, updatedAt: new Date().toISOString() } : a,
                ),
              }
            : d,
        );
        if (existing) {
          const merged = { ...existing, ...patch };
          const action =
            patch.status === "paused"
              ? "paused"
              : patch.status === "active" && existing.status === "paused"
                ? "activated"
                : "updated";
          await notifyStrategyAssignment(
            ws,
            organizationId || DEMO_WORKSPACE_ORG_ID,
            merged,
            liveStrategies,
            action,
          );
        }
        return;
      }
      if (!canLive) throw new Error("No organization context");
      await persistStrategyAssignmentUpdate(getFirebaseDb(), id, patch);
      if (existing) {
        const merged = { ...existing, ...patch };
        const action =
          patch.status === "paused"
            ? "paused"
            : patch.status === "active" && existing.status === "paused"
              ? "activated"
              : "updated";
        await notifyStrategyAssignment(ws, organizationId, merged, liveStrategies, action);
      }
    },
    [ws, canLive, organizationId, liveAssignments, liveStrategies],
  );

  const deleteAssignment = React.useCallback(
    async (id: string) => {
      const existing = liveAssignments.find((a) => a.id === id);
      if (ws.isDemo) {
        setDemoDelta((d) =>
          d ? { ...d, assignments: d.assignments.filter((a) => a.id !== id) } : d,
        );
        if (existing) {
          await notifyStrategyAssignment(
            ws,
            organizationId || DEMO_WORKSPACE_ORG_ID,
            existing,
            liveStrategies,
            "removed",
          );
        }
        return;
      }
      if (!canLive) throw new Error("No organization context");
      await persistStrategyAssignmentDelete(getFirebaseDb(), id);
      if (existing) {
        await notifyStrategyAssignment(ws, organizationId, existing, liveStrategies, "removed");
      }
    },
    [ws, canLive, organizationId, liveAssignments, liveStrategies],
  );

  const importStrategyPack = React.useCallback(
    async (pack: StrategyPack) => {
      const org = organizationId || DEMO_WORKSPACE_ORG_ID;
      const materialized = materializeStrategyPack(pack, {
        organizationId: org,
        userId: ws.currentUserId,
        newId,
        preserveIds: false,
      });

      if (ws.isDemo) {
        setDemoDelta((d) => {
          const byId = new Map((d?.personas ?? []).map((p) => [p.id, p]));
          for (const p of materialized.personas) byId.set(p.id, p);
          return {
            personas: [...byId.values()],
            strategies: [
              ...(d?.strategies ?? []).filter((s) => s.id !== materialized.strategy.id),
              materialized.strategy,
            ],
            assignments: d?.assignments ?? [],
          };
        });
      } else {
        if (!canLive) throw new Error("No organization context");
        await persistProspectingSeedBatch(
          getFirebaseDb(),
          organizationId,
          materialized.personas,
          materialized.strategy,
        );
      }
      const actor = actorLabel(ws.users, ws.currentUserId);
      const name = materialized.strategy.name?.trim() || pack.name || "strategy pack";
      emitStrategyOrgActivity(ws, {
        type: "strategy_pack_imported",
        summary: `${actor} imported strategy pack “${name}”`,
        strategyId: materialized.strategy.id,
        strategyName: name,
      });
      recordStrategyAuditClient({
        event: "strategy.pack_imported",
        strategyId: materialized.strategy.id,
        strategyName: name,
      });
      return {
        strategyId: materialized.strategy.id,
        warnings: materialized.warnings,
      };
    },
    [ws, organizationId, canLive],
  );

  const installSamplePack = React.useCallback(async () => {
    const parsed = parseStrategyPack(buildSampleB2bSaasPack());
    if (!parsed.ok) throw new Error(parsed.error);
    return importStrategyPack(parsed.pack);
  }, [importStrategyPack]);

  const exportStrategyPackFn = React.useCallback(
    (strategyId: string): StrategyPack | null => {
      const strategy = liveStrategies.find((s) => s.id === strategyId);
      if (!strategy) return null;
      return strategyToPack({
        packId: strategy.id,
        name: strategy.name,
        description: strategy.description,
        strategy,
        personas: livePersonas,
      });
    },
    [liveStrategies, livePersonas],
  );

  const seedMasterPack = React.useCallback(async () => {
    const ownerId = ws.currentUserId;
    const personasSeed = buildSeedPersonas(organizationId || DEMO_WORKSPACE_ORG_ID, ownerId);
    const strategySeed = buildSeedStrategy(organizationId || DEMO_WORKSPACE_ORG_ID, ownerId);
    if (ws.isDemo) {
      setDemoDelta({
        personas: personasSeed,
        strategies: [strategySeed],
        assignments: demoDelta?.assignments ?? [],
      });
      return;
    }
    if (!canLive) throw new Error("No organization context");
    await persistProspectingSeedBatch(
      getFirebaseDb(),
      organizationId,
      personasSeed,
      strategySeed,
    );
  }, [ws.isDemo, ws.currentUserId, organizationId, canLive, demoDelta?.assignments]);

  return {
    loading,
    personas: livePersonas,
    strategies: liveStrategies,
    assignments: liveAssignments,
    organizationId: organizationId || DEMO_WORKSPACE_ORG_ID,
    addPersona,
    updatePersona,
    deletePersona,
    addStrategy,
    updateStrategy,
    deleteStrategy,
    addAssignment,
    updateAssignment,
    deleteAssignment,
    installSamplePack,
    importStrategyPack,
    exportStrategyPack: exportStrategyPackFn,
    seedMasterPack,
  };
}
