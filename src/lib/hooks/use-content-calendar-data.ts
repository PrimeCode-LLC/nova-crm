"use client";

import * as React from "react";
import { collection, getDocs, query, where } from "@/lib/db/document-shim/shim-client-firestore";
import { toast } from "sonner";

import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { getClientDb } from "@/lib/db/document-access/client";
import { COLLECTIONS } from "@/lib/documents/collections";
import { buildBrandDefaultsFromPack } from "@/lib/content-calendar/strategy-packs";
import {
  mapContentBrand,
  mapContentCapture,
  mapContentItem,
  mapContentPlan,
} from "@/lib/content-calendar/map-docs";
import type {
  ContentBrand,
  ContentBrandKind,
  ContentCapture,
  ContentFormat,
  ContentItem,
  ContentItemStatus,
  ContentPlan,
  ContentPlatform,
  ContentPrimaryOutcome,
  ContentStrategyStyle,
} from "@/lib/content-calendar/types";
import {
  applyManualStatusToChecklist,
  CONTENT_DONE_STATUSES,
} from "@/lib/content-calendar/types";
import { buildDemoContentCalendar } from "@/lib/demo-content-calendar";
import { DEMO_WORKSPACE_ORG_ID } from "@/lib/demo-workspace-ids";
import {
  persistContentBrandCreate,
  persistContentBrandDelete,
  persistContentBrandUpdate,
  persistContentCaptureCreate,
  persistContentCaptureUpdate,
  persistContentItemCreate,
  persistContentItemDelete,
  persistContentItemUpdate,
  persistContentPlanCreate,
  persistContentPlanUpdate,
} from "@/lib/documents/persist-content-calendar-client";

function newId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * One-shot reads (getDocs) instead of onSnapshot.
 * Content pages were crashing the app with Firestore INTERNAL ASSERTION
 * when four concurrent watch listeners joined an already-busy WebChannel.
 */
export function useContentCalendarData() {
  const ws = useWorkspace();
  const organizationId = ws.organizationId || (ws.isDemo ? DEMO_WORKSPACE_ORG_ID : undefined);
  const isDemo = ws.isDemo;
  const currentUserId = ws.currentUserId;

  const [brands, setBrands] = React.useState<ContentBrand[]>([]);
  const [items, setItems] = React.useState<ContentItem[]>([]);
  const [captures, setCaptures] = React.useState<ContentCapture[]>([]);
  const [plans, setPlans] = React.useState<ContentPlan[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [reloadToken, setReloadToken] = React.useState(0);

  const reload = React.useCallback(() => {
    setReloadToken((n) => n + 1);
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      if (isDemo) {
        if (!cancelled) {
          const seed = buildDemoContentCalendar();
          setBrands(seed.brands);
          setItems(seed.items);
          setCaptures(seed.captures);
          setPlans(seed.plans);
          setLoading(false);
        }
        return;
      }

      if (!organizationId) {
        if (!cancelled) {
          setBrands([]);
          setItems([]);
          setCaptures([]);
          setPlans([]);
          setLoading(false);
        }
        return;
      }

      const db = getClientDb();
      if (!db) {
        if (!cancelled) setLoading(false);
        return;
      }

      if (!cancelled) setLoading(true);

      try {
        const orgQ = (col: string) =>
          query(collection(db, col), where("organizationId", "==", organizationId));

        const [brandSnap, itemSnap, captureSnap, planSnap] = await Promise.all([
          getDocs(orgQ(COLLECTIONS.contentBrands)),
          getDocs(orgQ(COLLECTIONS.contentItems)),
          getDocs(orgQ(COLLECTIONS.contentCaptures)),
          getDocs(orgQ(COLLECTIONS.contentPlans)),
        ]);

        if (cancelled) return;

        setBrands(
          brandSnap.docs.map((d) => mapContentBrand(d.id, d.data() as Record<string, unknown>)),
        );
        setItems(
          itemSnap.docs.map((d) => mapContentItem(d.id, d.data() as Record<string, unknown>)),
        );
        setCaptures(
          captureSnap.docs.map((d) =>
            mapContentCapture(d.id, d.data() as Record<string, unknown>),
          ),
        );
        setPlans(
          planSnap.docs.map((d) => mapContentPlan(d.id, d.data() as Record<string, unknown>)),
        );
      } catch (e) {
        console.error("[content-calendar] load failed", e);
        if (!cancelled) toast.error("Could not load content calendar data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [organizationId, isDemo, reloadToken]);

  const createBrand = React.useCallback(
    async (input: {
      name: string;
      kind: ContentBrandKind;
      primaryOutcome?: ContentPrimaryOutcome;
      contentStrategy?: ContentStrategyStyle;
      platforms?: ContentPlatform[];
      strategyPackId?: string;
      knowledgeLibraryIds?: string[];
      positioning?: string;
      voiceRules?: string;
      targetAudience?: string;
      offersToPromote?: string;
      topicsToAvoid?: string[];
      referenceCreators?: string;
      proofSources?: string;
      preferredCtas?: string;
      defaultFormats?: ContentFormat[];
      approvalRequired?: boolean;
      bannedPhrases?: string[];
      weeklyPublishTarget?: number;
      preferredWeekdays?: number[];
      responsibilities?: ContentBrand["responsibilities"];
      capturePolicy?: ContentBrand["capturePolicy"];
    }) => {
      if (!organizationId) throw new Error("No organization");
      if (isDemo) {
        const defaults = buildBrandDefaultsFromPack({
          kind: input.kind,
          name: input.name,
          primaryOutcome: input.primaryOutcome,
          contentStrategy: input.contentStrategy,
          platforms: input.platforms,
          strategyPackId: input.strategyPackId,
        });
        const now = new Date().toISOString();
        const brand: ContentBrand = {
          id: newId("cbrand"),
          organizationId,
          name: input.name.trim(),
          kind: input.kind,
          ...defaults,
          goal: defaults.primaryOutcome,
          positioning: input.positioning?.trim() || defaults.positioning,
          voiceRules: input.voiceRules?.trim() || defaults.voiceRules,
          targetAudience: input.targetAudience?.trim() || defaults.targetAudience,
          offersToPromote: input.offersToPromote?.trim() || defaults.offersToPromote,
          topicsToAvoid: input.topicsToAvoid ?? defaults.topicsToAvoid,
          referenceCreators: input.referenceCreators?.trim() || defaults.referenceCreators,
          proofSources: input.proofSources?.trim() || "",
          preferredCtas: input.preferredCtas?.trim() || "",
          defaultFormats: input.defaultFormats?.length
            ? input.defaultFormats
            : defaults.defaultFormats,
          approvalRequired: input.approvalRequired ?? defaults.approvalRequired,
          bannedPhrases: input.bannedPhrases?.length ? input.bannedPhrases : defaults.bannedPhrases,
          cadence: {
            ...defaults.cadence,
            weeklyPublishTarget:
              input.weeklyPublishTarget ?? defaults.cadence.weeklyPublishTarget,
            preferredWeekdays: input.preferredWeekdays?.length
              ? input.preferredWeekdays
              : defaults.cadence.preferredWeekdays,
          },
          knowledgeLibraryIds: input.knowledgeLibraryIds ?? [],
          ownerUserId: currentUserId,
          defaultOwnerUserId: currentUserId,
          responsibilities: input.responsibilities ?? {
            planner: currentUserId,
            writer: currentUserId,
            designer: currentUserId,
            poster: currentUserId,
            capturer: currentUserId,
            approver: currentUserId,
          },
          capturePolicy: input.capturePolicy,
          active: true,
          createdAt: now,
          updatedAt: now,
        };
        setBrands((prev) => [...prev.filter((b) => b.id !== brand.id), brand]);
        toast.message("Demo mode - brand saved locally only");
        return brand;
      }
      const db = getClientDb();
      if (!db) throw new Error("Database unavailable");

      const defaults = buildBrandDefaultsFromPack({
        kind: input.kind,
        name: input.name,
        primaryOutcome: input.primaryOutcome,
        contentStrategy: input.contentStrategy,
        platforms: input.platforms,
        strategyPackId: input.strategyPackId,
      });
      const now = new Date().toISOString();
      const brand: ContentBrand = {
        id: newId("cbrand"),
        organizationId,
        name: input.name.trim(),
        kind: input.kind,
        ...defaults,
        goal: defaults.primaryOutcome,
        positioning: input.positioning?.trim() || defaults.positioning,
        voiceRules: input.voiceRules?.trim() || defaults.voiceRules,
        targetAudience: input.targetAudience?.trim() || defaults.targetAudience,
        offersToPromote: input.offersToPromote?.trim() || defaults.offersToPromote,
        topicsToAvoid: input.topicsToAvoid ?? defaults.topicsToAvoid,
        referenceCreators: input.referenceCreators?.trim() || defaults.referenceCreators,
        proofSources: input.proofSources?.trim() || "",
        preferredCtas: input.preferredCtas?.trim() || "",
        defaultFormats: input.defaultFormats?.length
          ? input.defaultFormats
          : defaults.defaultFormats,
        approvalRequired: input.approvalRequired ?? defaults.approvalRequired,
        bannedPhrases: input.bannedPhrases?.length ? input.bannedPhrases : defaults.bannedPhrases,
        cadence: {
          ...defaults.cadence,
          weeklyPublishTarget:
            input.weeklyPublishTarget ?? defaults.cadence.weeklyPublishTarget,
          preferredWeekdays: input.preferredWeekdays?.length
            ? input.preferredWeekdays
            : defaults.cadence.preferredWeekdays,
        },
        knowledgeLibraryIds: input.knowledgeLibraryIds ?? [],
        ownerUserId: currentUserId,
        defaultOwnerUserId: currentUserId,
        responsibilities: input.responsibilities ?? {
          planner: currentUserId,
          writer: currentUserId,
          designer: currentUserId,
          poster: currentUserId,
          capturer: currentUserId,
          approver: currentUserId,
        },
        capturePolicy: input.capturePolicy,
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      await persistContentBrandCreate(db, organizationId, brand);
      setBrands((prev) => [...prev.filter((b) => b.id !== brand.id), brand]);
      toast.success("Brand created");
      return brand;
    },
    [organizationId, isDemo, currentUserId],
  );

  const updateBrand = React.useCallback(
    async (brandId: string, patch: Partial<ContentBrand>) => {
      const updatedAt = new Date().toISOString();
      if (isDemo) {
        setBrands((prev) =>
          prev.map((b) => (b.id === brandId ? { ...b, ...patch, updatedAt } : b)),
        );
        toast.message("Demo mode - not persisted");
        return;
      }
      const db = getClientDb();
      if (!db) throw new Error("Database unavailable");
      await persistContentBrandUpdate(db, brandId, { ...patch, updatedAt });
      setBrands((prev) =>
        prev.map((b) => (b.id === brandId ? { ...b, ...patch, updatedAt } : b)),
      );
      toast.success("Brand updated");
    },
    [isDemo],
  );

  const deleteBrand = React.useCallback(
    async (brandId: string) => {
      if (isDemo) {
        setBrands((prev) => prev.filter((b) => b.id !== brandId));
        toast.message("Demo mode - not persisted");
        return;
      }
      const db = getClientDb();
      if (!db) throw new Error("Database unavailable");
      await persistContentBrandDelete(db, brandId);
      setBrands((prev) => prev.filter((b) => b.id !== brandId));
      toast.success("Brand deleted");
    },
    [isDemo],
  );

  const itemsRef = React.useRef(items);
  itemsRef.current = items;

  const updateItemStatus = React.useCallback(
    async (itemId: string, status: ContentItemStatus) => {
      const updatedAt = new Date().toISOString();
      const actorId = currentUserId || "unknown";
      const isDone = CONTENT_DONE_STATUSES.includes(status);
      const completedAt = isDone ? updatedAt : null;
      const current = itemsRef.current.find((i) => i.id === itemId);
      const checklist = current?.checklist?.length
        ? applyManualStatusToChecklist(current.checklist, status, actorId, updatedAt)
        : current?.checklist;

      const applyLocal = (item: ContentItem): ContentItem => ({
        ...item,
        status,
        updatedAt,
        completedAt: completedAt ?? undefined,
        ...(checklist ? { checklist } : {}),
      });

      if (isDemo) {
        setItems((prev) => prev.map((i) => (i.id === itemId ? applyLocal(i) : i)));
        toast.message("Demo mode - not persisted");
        return;
      }
      const db = getClientDb();
      if (!db) throw new Error("Database unavailable");
      await persistContentItemUpdate(db, itemId, {
        status,
        completedAt,
        updatedAt,
        ...(checklist ? { checklist } : {}),
      });
      setItems((prev) => prev.map((i) => (i.id === itemId ? applyLocal(i) : i)));
    },
    [isDemo, currentUserId],
  );

  const updateItem = React.useCallback(
    async (itemId: string, patch: Partial<ContentItem>) => {
      const updatedAt = new Date().toISOString();
      if (isDemo) {
        setItems((prev) =>
          prev.map((i) => (i.id === itemId ? { ...i, ...patch, updatedAt } : i)),
        );
        return;
      }
      const db = getClientDb();
      if (!db) throw new Error("Database unavailable");
      await persistContentItemUpdate(db, itemId, { ...patch, updatedAt });
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, ...patch, updatedAt } : i)),
      );
    },
    [isDemo],
  );

  const createItem = React.useCallback(
    async (item: Omit<ContentItem, "id" | "organizationId" | "createdAt" | "updatedAt">) => {
      if (!organizationId) return null;
      const now = new Date().toISOString();
      const full: ContentItem = {
        ...item,
        id: newId("citem"),
        organizationId,
        createdAt: now,
        updatedAt: now,
      };
      if (isDemo) {
        setItems((prev) => [...prev, full]);
        toast.message("Demo mode - not persisted");
        return full;
      }
      const db = getClientDb();
      if (!db) throw new Error("Database unavailable");
      await persistContentItemCreate(db, organizationId, full);
      setItems((prev) => [...prev, full]);
      return full;
    },
    [organizationId, isDemo],
  );

  const deleteItem = React.useCallback(
    async (itemId: string) => {
      if (isDemo) {
        setItems((prev) => prev.filter((i) => i.id !== itemId));
        return;
      }
      const db = getClientDb();
      if (!db) return;
      await persistContentItemDelete(db, itemId);
      setItems((prev) => prev.filter((i) => i.id !== itemId));
    },
    [isDemo],
  );

  const createCapture = React.useCallback(
    async (
      input: Omit<
        ContentCapture,
        "id" | "organizationId" | "createdAt" | "updatedAt" | "createdById" | "status"
      >,
    ) => {
      if (!organizationId) return null;
      const now = new Date().toISOString();
      const capture: ContentCapture = {
        ...input,
        id: newId("ccap"),
        organizationId,
        createdById: currentUserId,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      };
      if (isDemo) {
        setCaptures((prev) => [capture, ...prev]);
        toast.message("Demo mode - not persisted");
        return capture;
      }
      const db = getClientDb();
      if (!db) throw new Error("Database unavailable");
      await persistContentCaptureCreate(db, organizationId, capture);
      setCaptures((prev) => [capture, ...prev]);
      return capture;
    },
    [organizationId, isDemo, currentUserId],
  );

  const updateCapture = React.useCallback(
    async (
      captureId: string,
      patch: Omit<Partial<ContentCapture>, "errorMessage"> & { errorMessage?: string | null },
    ) => {
      const updatedAt = new Date().toISOString();
      const applyLocal = (prev: ContentCapture[]) =>
        prev.map((c) => {
          if (c.id !== captureId) return c;
          const next: ContentCapture = { ...c, ...patch, updatedAt, errorMessage: c.errorMessage };
          if (patch.errorMessage === null) delete next.errorMessage;
          else if (typeof patch.errorMessage === "string") next.errorMessage = patch.errorMessage;
          return next;
        });
      if (isDemo) {
        setCaptures(applyLocal);
        return;
      }
      const db = getClientDb();
      if (!db) return;
      await persistContentCaptureUpdate(db, captureId, { ...patch, updatedAt });
      setCaptures(applyLocal);
    },
    [isDemo],
  );

  const deleteCapture = React.useCallback(
    async (captureId: string) => {
      if (isDemo) {
        setCaptures((prev) => prev.filter((c) => c.id !== captureId));
        toast.message("Demo mode - not persisted");
        return true;
      }
      const res = await fetch(`/api/ai/content-capture/${encodeURIComponent(captureId)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(json.error || "Could not delete capture");
        return false;
      }
      setCaptures((prev) => prev.filter((c) => c.id !== captureId));
      return true;
    },
    [isDemo],
  );

  const savePlan = React.useCallback(
    async (plan: ContentPlan, isNew: boolean) => {
      if (!organizationId) return;
      if (isDemo) {
        setPlans((prev) => {
          const without = prev.filter((p) => p.id !== plan.id);
          return [...without, plan];
        });
        toast.message("Demo mode - not persisted");
        return;
      }
      const db = getClientDb();
      if (!db) return;
      if (isNew) await persistContentPlanCreate(db, organizationId, plan);
      else await persistContentPlanUpdate(db, plan.id, plan);
      setPlans((prev) => {
        const without = prev.filter((p) => p.id !== plan.id);
        return [...without, plan];
      });
    },
    [organizationId, isDemo],
  );

  return {
    brands,
    items,
    captures,
    plans,
    loading,
    isDemo,
    organizationId,
    currentUserId,
    reload,
    createBrand,
    updateBrand,
    deleteBrand,
    createItem,
    updateItem,
    updateItemStatus,
    deleteItem,
    createCapture,
    updateCapture,
    deleteCapture,
    savePlan,
  };
}
