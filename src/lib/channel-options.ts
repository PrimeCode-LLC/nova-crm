import { CHANNEL_LIST } from "@/lib/constants";
import type { ChannelKey } from "@/lib/types";

export type ChannelOption = { key: string; label: string };

export type BuildChannelOptionsInput = {
  customChannels: { id: string; name: string; enabled?: boolean }[];
  /** Built-in channel enable flags. Missing keys default to enabled. */
  enabledMap?: Partial<Record<ChannelKey, boolean>>;
  /**
   * When true, include disabled channels (admin lists, labels on existing data).
   * Default false — only enabled channels for pickers/widgets.
   */
  includeDisabled?: boolean;
};

/** Built-in channels plus workspace custom channels (`custom_<id>` keys). */
export function buildChannelOptions(
  customChannelsOrInput:
    | { id: string; name: string; enabled?: boolean }[]
    | BuildChannelOptionsInput,
  maybeOpts?: Omit<BuildChannelOptionsInput, "customChannels">,
): ChannelOption[] {
  const input: BuildChannelOptionsInput = Array.isArray(customChannelsOrInput)
    ? { customChannels: customChannelsOrInput, ...maybeOpts }
    : customChannelsOrInput;

  const { customChannels, enabledMap, includeDisabled = false } = input;

  const builtins = CHANNEL_LIST.filter((c) => {
    if (includeDisabled) return true;
    return enabledMap?.[c.key] !== false;
  }).map((c) => ({ key: c.key, label: c.label }));

  const customs = customChannels
    .filter((c) => {
      if (includeDisabled) return true;
      return c.enabled !== false;
    })
    .map((c) => ({ key: `custom_${c.id}`, label: c.name.trim() }))
    .filter((c) => c.label.length > 0);

  return [...builtins, ...customs];
}

/** Whether a channel key is enabled for pickers/widgets. */
export function isChannelEnabled(
  key: string,
  enabledMap: Partial<Record<ChannelKey, boolean>> | undefined,
  customChannels: { id: string; enabled?: boolean }[],
): boolean {
  if (key.startsWith("custom_")) {
    const id = key.slice("custom_".length);
    const row = customChannels.find((c) => c.id === id);
    if (!row) return false;
    return row.enabled !== false;
  }
  return enabledMap?.[key as ChannelKey] !== false;
}

export function channelLabelFromValue(
  value: string | undefined,
  options: ChannelOption[],
): string {
  if (!value) return "";
  return options.find((o) => o.key === value)?.label ?? value;
}
