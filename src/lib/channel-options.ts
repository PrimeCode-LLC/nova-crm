import { CHANNEL_LIST } from "@/lib/constants";

export type ChannelOption = { key: string; label: string };

/** Built-in channels plus workspace custom channels (`custom_<id>` keys). */
export function buildChannelOptions(
  customChannels: { id: string; name: string }[],
): ChannelOption[] {
  return [
    ...CHANNEL_LIST.map((c) => ({ key: c.key, label: c.label })),
    ...customChannels
      .map((c) => ({ key: `custom_${c.id}`, label: c.name.trim() }))
      .filter((c) => c.label.length > 0),
  ];
}

export function channelLabelFromValue(
  value: string | undefined,
  options: ChannelOption[],
): string {
  if (!value) return "";
  return options.find((o) => o.key === value)?.label ?? value;
}
