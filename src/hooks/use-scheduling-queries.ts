"use client";

import { useQuery } from "@tanstack/react-query";
import type { CalendarDelegatePermission, Meeting, SchedulingLink } from "@/lib/types";

export type BookableHost = {
  hostId: string;
  hostName: string;
  permissions?: CalendarDelegatePermission[];
};

export const bookableHostsQueryKey = ["scheduling", "bookable_hosts"] as const;

export function schedulingLinksQueryKey(hostId: string) {
  return ["scheduling", "links", hostId] as const;
}

export function leadMeetingsQueryKey(leadId: string) {
  return ["scheduling", "meetings", "lead", leadId] as const;
}

export function hostMeetingsQueryKey(hostId: string) {
  return ["scheduling", "meetings", "host", hostId] as const;
}

export async function fetchBookableHosts(): Promise<BookableHost[]> {
  const res = await fetch("/api/scheduling/delegations?mode=bookable_hosts");
  const data = (await res.json()) as {
    ok?: boolean;
    hosts?: BookableHost[];
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? "Failed to load bookable hosts");
  }
  return data.hosts ?? [];
}

export async function fetchSchedulingLinks(hostId: string): Promise<{
  items: SchedulingLink[];
  orgSlug?: string;
  orgName?: string;
}> {
  const res = await fetch(
    `/api/scheduling/links?hostId=${encodeURIComponent(hostId)}`,
  );
  const data = (await res.json()) as {
    ok?: boolean;
    items?: SchedulingLink[];
    orgSlug?: string;
    orgName?: string;
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? "Failed to load scheduling links");
  }
  return {
    items: data.items ?? [],
    orgSlug: data.orgSlug,
    orgName: data.orgName,
  };
}

export async function fetchLeadMeetings(leadId: string): Promise<Meeting[]> {
  const res = await fetch(
    `/api/scheduling/meetings?leadId=${encodeURIComponent(leadId)}`,
  );
  const data = (await res.json()) as {
    ok?: boolean;
    items?: Meeting[];
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? "Failed to load meetings");
  }
  return data.items ?? [];
}

export async function fetchHostMeetings(hostId: string): Promise<Meeting[]> {
  const res = await fetch(
    `/api/scheduling/meetings?hostId=${encodeURIComponent(hostId)}`,
  );
  const data = (await res.json()) as {
    ok?: boolean;
    items?: Meeting[];
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? "Failed to load meetings");
  }
  return data.items ?? [];
}

/** Org calendars the viewer can book on (delegations). */
export function useBookableHosts(enabled = true) {
  return useQuery({
    queryKey: bookableHostsQueryKey,
    queryFn: fetchBookableHosts,
    enabled,
    staleTime: 60_000,
  });
}

export function useSchedulingLinks(hostId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: schedulingLinksQueryKey(hostId ?? ""),
    queryFn: () => fetchSchedulingLinks(hostId!),
    enabled: enabled && Boolean(hostId),
    staleTime: 30_000,
  });
}

export function useLeadMeetings(leadId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: leadMeetingsQueryKey(leadId ?? ""),
    queryFn: () => fetchLeadMeetings(leadId!),
    enabled: enabled && Boolean(leadId),
    staleTime: 30_000,
  });
}

export function useHostMeetings(hostId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: hostMeetingsQueryKey(hostId ?? ""),
    queryFn: () => fetchHostMeetings(hostId!),
    enabled: enabled && Boolean(hostId),
    staleTime: 30_000,
  });
}
