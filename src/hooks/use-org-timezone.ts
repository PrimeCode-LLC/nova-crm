"use client";

import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { resolveOrgTimezone } from "@/lib/org-timezone";

/** Effective IANA timezone: sticky org setting, else browser. */
export function useOrgTimezone(): string {
  const { organizationTimezone } = useWorkspace();
  return resolveOrgTimezone(organizationTimezone);
}
