"use client";

import * as React from "react";
import {
  buildChannelOptions,
  type ChannelOption,
} from "@/lib/channel-options";
import { useChannelAdminStore } from "@/stores/channel-admin-store";
import type { ChannelKey } from "@/lib/types";
import { CHANNEL_LIST } from "@/lib/constants";

/** Channel options for pickers — disabled channels excluded by default. */
export function useChannelOptions(opts?: {
  includeDisabled?: boolean;
}): ChannelOption[] {
  const customChannels = useChannelAdminStore((s) => s.customChannels);
  const enabledMap = useChannelAdminStore((s) => s.enabledMap);
  const includeDisabled = opts?.includeDisabled ?? false;

  return React.useMemo(
    () =>
      buildChannelOptions({
        customChannels,
        enabledMap,
        includeDisabled,
      }),
    [customChannels, enabledMap, includeDisabled],
  );
}

/** Enabled built-in channel keys (for dashboard funnels / mix). */
export function useEnabledBuiltinChannelKeys(): ChannelKey[] {
  const enabledMap = useChannelAdminStore((s) => s.enabledMap);
  return React.useMemo(
    () => CHANNEL_LIST.filter((c) => enabledMap[c.key] !== false).map((c) => c.key),
    [enabledMap],
  );
}
