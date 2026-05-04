"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ChannelKey, OrganizationChannelAdminConfig } from "@/lib/types";
import type { OrganizationCustomChannelRow } from "@/lib/types";
import { DEFAULT_CHANNEL_AUTO } from "@/lib/channel-admin-defaults";

/** @deprecated name — use OrganizationCustomChannelRow */
export type CustomChannelRow = OrganizationCustomChannelRow;

export type ChannelAdminPersisted = OrganizationChannelAdminConfig;

export interface ChannelAdminState extends OrganizationChannelAdminConfig {
  setAuto: (key: ChannelKey, value: boolean) => void;
  setDescriptionOverride: (key: ChannelKey, value: string | undefined) => void;
  addCustomChannel: (input: Omit<OrganizationCustomChannelRow, "id">) => void;
  updateCustomChannel: (
    id: string,
    patch: Partial<Omit<OrganizationCustomChannelRow, "id">>,
  ) => void;
  removeCustomChannel: (id: string) => void;
}

const emptyPersisted: OrganizationChannelAdminConfig = {
  autoMap: { ...DEFAULT_CHANNEL_AUTO },
  descriptionOverrides: {},
  customChannels: [],
};

export function parseStagesInput(raw: string): { key: string; label: string }[] {
  const lines = raw
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
  return lines.map((label, i) => ({
    key: label
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "") || `stage_${i}`,
    label,
  }));
}

export function getChannelAdminPersistedSnapshot(
  s: Pick<ChannelAdminState, "autoMap" | "descriptionOverrides" | "customChannels">,
): OrganizationChannelAdminConfig {
  return {
    autoMap: s.autoMap,
    descriptionOverrides: s.descriptionOverrides,
    customChannels: s.customChannels,
  };
}

export const useChannelAdminStore = create<ChannelAdminState>()(
  persist(
    (set, get) => ({
      ...emptyPersisted,
      setAuto: (key, value) =>
        set({ autoMap: { ...get().autoMap, [key]: value } }),
      setDescriptionOverride: (key, value) =>
        set({
          descriptionOverrides: (() => {
            const next = { ...get().descriptionOverrides };
            if (value === undefined || value.trim() === "") delete next[key];
            else next[key] = value.trim();
            return next;
          })(),
        }),
      addCustomChannel: (input) =>
        set({
          customChannels: [
            ...get().customChannels,
            {
              ...input,
              id: globalThis.crypto?.randomUUID?.() ?? `c_${Date.now()}`,
            },
          ],
        }),
      updateCustomChannel: (id, patch) =>
        set({
          customChannels: get().customChannels.map((c) =>
            c.id === id ? { ...c, ...patch } : c,
          ),
        }),
      removeCustomChannel: (id) =>
        set({
          customChannels: get().customChannels.filter((c) => c.id !== id),
        }),
    }),
    {
      name: "nova-crm-channel-admin",
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const p = persisted as Partial<OrganizationChannelAdminConfig> | undefined;
        if (!p || typeof p !== "object") return current as ChannelAdminState;
        return {
          ...(current as ChannelAdminState),
          autoMap: { ...DEFAULT_CHANNEL_AUTO, ...(p.autoMap ?? {}) },
          descriptionOverrides:
            p.descriptionOverrides && typeof p.descriptionOverrides === "object"
              ? (p.descriptionOverrides as Partial<Record<ChannelKey, string>>)
              : {},
          customChannels: Array.isArray(p.customChannels) ? p.customChannels : [],
        };
      },
    },
  ),
);
