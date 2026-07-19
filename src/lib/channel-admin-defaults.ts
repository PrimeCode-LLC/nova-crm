import type {
  ChannelKey,
  OrganizationChannelAdminConfig,
  OrganizationCustomChannelRow,
} from "@/lib/types";
import { CHANNEL_LIST } from "@/lib/constants";

/** Default “Auto” toggle per built-in channel (same as legacy localStorage defaults). */
export const DEFAULT_CHANNEL_AUTO: Record<ChannelKey, boolean> = {
  cold_email: true,
  personalized_email: false,
  linkedin_outbound: true,
  linkedin_1to1: false,
  website_form: true,
  upwork: false,
  job_apply: false,
};

/** Default: all built-in channels enabled. */
export const DEFAULT_CHANNEL_ENABLED: Record<ChannelKey, boolean> = Object.fromEntries(
  CHANNEL_LIST.map((c) => [c.key, true]),
) as Record<ChannelKey, boolean>;

function normalizeCustomChannel(row: OrganizationCustomChannelRow): OrganizationCustomChannelRow {
  return {
    ...row,
    enabled: row.enabled !== false,
  };
}

export function mergeChannelAdminConfig(
  partial?: Partial<{
    autoMap: Partial<Record<ChannelKey, boolean>>;
    enabledMap: Partial<Record<ChannelKey, boolean>>;
    descriptionOverrides: Partial<Record<ChannelKey, string>>;
    customChannels: OrganizationCustomChannelRow[];
  }> | null,
): OrganizationChannelAdminConfig {
  return {
    autoMap: { ...DEFAULT_CHANNEL_AUTO, ...(partial?.autoMap ?? {}) },
    enabledMap: { ...DEFAULT_CHANNEL_ENABLED, ...(partial?.enabledMap ?? {}) },
    descriptionOverrides: partial?.descriptionOverrides
      ? { ...partial.descriptionOverrides }
      : {},
    customChannels: Array.isArray(partial?.customChannels)
      ? partial.customChannels.map(normalizeCustomChannel)
      : [],
  };
}
