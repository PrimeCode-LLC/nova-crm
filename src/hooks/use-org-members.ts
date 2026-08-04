"use client";

import { useQuery } from "@tanstack/react-query";
import type { OrganizationMember } from "@/lib/types";

export const orgMembersQueryKey = ["org", "members"] as const;

export async function fetchOrgMembers(): Promise<OrganizationMember[]> {
  const res = await fetch("/api/org/members", {
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw new Error("Failed to load organization members");
  }
  const data = (await res.json()) as { members?: OrganizationMember[] };
  return data.members ?? [];
}

/** Shared org roster — deduped across the app with a 60s stale window. */
export function useOrgMembers(enabled = true) {
  return useQuery({
    queryKey: orgMembersQueryKey,
    queryFn: fetchOrgMembers,
    enabled,
    staleTime: 60_000,
  });
}
