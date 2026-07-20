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
import {
  buildPerson1Personas,
  buildPerson1Strategy,
} from "@/lib/prospecting-strategy/person1-seed";
import { DEMO_WORKSPACE_ORG_ID } from "@/lib/demo-workspace-ids";

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
  seedMasterPack: () => Promise<void>;
  seedPerson1Pack: () => Promise<void>;
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
        return;
      }
      if (!canLive) throw new Error("No organization context");
      await persistProspectingStrategyCreate(getFirebaseDb(), organizationId, strategy);
    },
    [ws.isDemo, canLive, organizationId],
  );

  const updateStrategy = React.useCallback(
    async (id: string, patch: Partial<ProspectingStrategy>) => {
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
        return;
      }
      if (!canLive) throw new Error("No organization context");
      await persistProspectingStrategyUpdate(getFirebaseDb(), id, patch);
    },
    [ws.isDemo, canLive],
  );

  const deleteStrategy = React.useCallback(
    async (id: string) => {
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
        return;
      }
      if (!canLive) throw new Error("No organization context");
      await persistProspectingStrategyDelete(getFirebaseDb(), id);
    },
    [ws.isDemo, canLive],
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
        return;
      }
      if (!canLive) throw new Error("No organization context");
      await persistStrategyAssignmentCreate(getFirebaseDb(), organizationId, assignment);
    },
    [ws.isDemo, canLive, organizationId],
  );

  const updateAssignment = React.useCallback(
    async (id: string, patch: Partial<StrategyAssignment>) => {
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
        return;
      }
      if (!canLive) throw new Error("No organization context");
      await persistStrategyAssignmentUpdate(getFirebaseDb(), id, patch);
    },
    [ws.isDemo, canLive],
  );

  const deleteAssignment = React.useCallback(
    async (id: string) => {
      if (ws.isDemo) {
        setDemoDelta((d) =>
          d ? { ...d, assignments: d.assignments.filter((a) => a.id !== id) } : d,
        );
        return;
      }
      if (!canLive) throw new Error("No organization context");
      await persistStrategyAssignmentDelete(getFirebaseDb(), id);
    },
    [ws.isDemo, canLive],
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

  const seedPerson1Pack = React.useCallback(async () => {
    const ownerId = ws.currentUserId;
    const org = organizationId || DEMO_WORKSPACE_ORG_ID;
    const personasSeed = buildPerson1Personas(org, ownerId);
    const strategySeed = buildPerson1Strategy(org, ownerId);
    if (ws.isDemo) {
      setDemoDelta((d) => {
        const existingPersonas = d?.personas ?? [];
        const byId = new Map(existingPersonas.map((p) => [p.id, p]));
        for (const p of personasSeed) byId.set(p.id, p);
        const strategies = [
          ...(d?.strategies ?? []).filter((s) => s.id !== strategySeed.id),
          strategySeed,
        ];
        return {
          personas: [...byId.values()],
          strategies,
          assignments: d?.assignments ?? [],
        };
      });
      return;
    }
    if (!canLive) throw new Error("No organization context");
    await persistProspectingSeedBatch(getFirebaseDb(), organizationId, personasSeed, strategySeed);
  }, [ws.isDemo, ws.currentUserId, organizationId, canLive]);

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
    seedMasterPack,
    seedPerson1Pack,
  };
}
