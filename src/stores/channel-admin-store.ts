"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ChannelKey } from "@/lib/types";

export const DEFAULT_CHANNEL_AUTO: Record<ChannelKey, boolean> = {
  cold_email: true,
  personalized_email: false,
  linkedin_outbound: true,
  linkedin_1to1: false,
  website_form: true,
  upwork: false,
  job_apply: false,
};

export type CustomChannelRow = {
  id: string;
  name: string;
  description: string;
  stages: { key: string; label: string }[];
  auto: boolean;
};

export type ChannelAdminPersisted = {
  autoMap: Record<ChannelKey, boolean>;
  descriptionOverrides: Partial<Record<ChannelKey, string>>;
  customChannels: CustomChannelRow[];
};

export interface ChannelAdminState extends ChannelAdminPersisted {
  setAuto: (key: ChannelKey, value: boolean) => void;
  setDescriptionOverride: (key: ChannelKey, value: string | undefined) => void;
  addCustomChannel: (input: Omit<CustomChannelRow, "id">) => void;
  updateCustomChannel: (id: string, patch: Partial<Omit<CustomChannelRow, "id">>) => void;
  removeCustomChannel: (id: string) => void;
}

const emptyPersisted: ChannelAdminPersisted = {
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
            { ...input, id: globalThis.crypto?.randomUUID?.() ?? `c_${Date.now()}` },
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
        const p = persisted as Partial<ChannelAdminPersisted> | undefined;
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
