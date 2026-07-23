"use client";

import * as React from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { toast } from "sonner";

import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase/client";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { COLLECTIONS } from "@/lib/firestore/collections";
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
} from "@/lib/firestore/persist-content-calendar-client";

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
  const organizationId = ws.organizationId;
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
      if (isDemo || !organizationId || !isFirebaseWebConfigured()) {
        if (!cancelled) {
          setBrands([]);
          setItems([]);
          setCaptures([]);
          setPlans([]);
          setLoading(false);
        }
        return;
      }

      const auth = getFirebaseAuth();
      if (!auth.currentUser) {
        if (!cancelled) setLoading(false);
        return;
      }

      const db = getFirebaseDb();
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
    }) => {
      if (!organizationId) throw new Error("No organization");
      if (isDemo) {
        toast.message("Demo mode — brands are not persisted");
        return null;
      }
      const db = getFirebaseDb();
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
        },
        knowledgeLibraryIds: input.knowledgeLibraryIds ?? [],
        ownerUserId: currentUserId,
        defaultOwnerUserId: currentUserId,
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
      if (isDemo) {
        toast.message("Demo mode — not persisted");
        return;
      }
      const db = getFirebaseDb();
      if (!db) throw new Error("Database unavailable");
      const updatedAt = new Date().toISOString();
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
      if (isDemo) return;
      const db = getFirebaseDb();
      if (!db) throw new Error("Database unavailable");
      await persistContentBrandDelete(db, brandId);
      setBrands((prev) => prev.filter((b) => b.id !== brandId));
      toast.success("Brand deleted");
    },
    [isDemo],
  );

  const updateItemStatus = React.useCallback(
    async (itemId: string, status: ContentItemStatus) => {
      if (isDemo) {
        toast.message("Demo mode — not persisted");
        return;
      }
      const db = getFirebaseDb();
      if (!db) throw new Error("Database unavailable");
      const completedAt =
        status === "published" || status === "skipped" || status === "repurpose"
          ? new Date().toISOString()
          : undefined;
      const updatedAt = new Date().toISOString();
      await persistContentItemUpdate(db, itemId, {
        status,
        completedAt,
        updatedAt,
      });
      setItems((prev) =>
        prev.map((i) =>
          i.id === itemId ? { ...i, status, completedAt, updatedAt } : i,
        ),
      );
    },
    [isDemo],
  );

  const updateItem = React.useCallback(
    async (itemId: string, patch: Partial<ContentItem>) => {
      if (isDemo) return;
      const db = getFirebaseDb();
      if (!db) throw new Error("Database unavailable");
      const updatedAt = new Date().toISOString();
      await persistContentItemUpdate(db, itemId, { ...patch, updatedAt });
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, ...patch, updatedAt } : i)),
      );
    },
    [isDemo],
  );

  const createItem = React.useCallback(
    async (item: Omit<ContentItem, "id" | "organizationId" | "createdAt" | "updatedAt">) => {
      if (!organizationId || isDemo) return null;
      const db = getFirebaseDb();
      if (!db) throw new Error("Database unavailable");
      const now = new Date().toISOString();
      const full: ContentItem = {
        ...item,
        id: newId("citem"),
        organizationId,
        createdAt: now,
        updatedAt: now,
      };
      await persistContentItemCreate(db, organizationId, full);
      setItems((prev) => [...prev, full]);
      return full;
    },
    [organizationId, isDemo],
  );

  const deleteItem = React.useCallback(
    async (itemId: string) => {
      if (isDemo) return;
      const db = getFirebaseDb();
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
      if (!organizationId || isDemo) return null;
      const db = getFirebaseDb();
      if (!db) throw new Error("Database unavailable");
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
      await persistContentCaptureCreate(db, organizationId, capture);
      setCaptures((prev) => [capture, ...prev]);
      return capture;
    },
    [organizationId, isDemo, currentUserId],
  );

  const updateCapture = React.useCallback(
    async (captureId: string, patch: Partial<ContentCapture>) => {
      if (isDemo) return;
      const db = getFirebaseDb();
      if (!db) return;
      const updatedAt = new Date().toISOString();
      await persistContentCaptureUpdate(db, captureId, { ...patch, updatedAt });
      setCaptures((prev) =>
        prev.map((c) => (c.id === captureId ? { ...c, ...patch, updatedAt } : c)),
      );
    },
    [isDemo],
  );

  const savePlan = React.useCallback(
    async (plan: ContentPlan, isNew: boolean) => {
      if (!organizationId || isDemo) return;
      const db = getFirebaseDb();
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
    savePlan,
  };
}
