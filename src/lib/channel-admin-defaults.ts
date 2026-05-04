import type {
  ChannelKey,
  OrganizationChannelAdminConfig,
  OrganizationCustomChannelRow,
} from "@/lib/types";

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

export function mergeChannelAdminConfig(
  partial?: Partial<{
    autoMap: Partial<Record<ChannelKey, boolean>>;
    descriptionOverrides: Partial<Record<ChannelKey, string>>;
    customChannels: OrganizationCustomChannelRow[];
  }> | null,
): OrganizationChannelAdminConfig {
  return {
    autoMap: { ...DEFAULT_CHANNEL_AUTO, ...(partial?.autoMap ?? {}) },
    descriptionOverrides: partial?.descriptionOverrides
      ? { ...partial.descriptionOverrides }
      : {},
    customChannels: Array.isArray(partial?.customChannels) ? partial.customChannels : [],
  };
}
