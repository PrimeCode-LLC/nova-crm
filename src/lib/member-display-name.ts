import type { User } from "@/lib/types";

/** True when a user's stored name is missing or is just their uid. */
export function hasRealDisplayName(user: Pick<User, "id" | "displayName">): boolean {
  const name = user.displayName?.trim();
  return Boolean(name) && name !== user.id;
}

/**
 * users/{uid} written by older onboarding has no name, so mappers fall back to
 * the uid. Prefer the org member record's label in that case (QA 2.2).
 * Returns the same object when nothing changes (keeps memo identity stable).
 */
export function withMemberDisplayName<T extends Pick<User, "id" | "displayName">>(
  user: T,
  memberLabels: Readonly<Record<string, string>>,
): T {
  if (hasRealDisplayName(user)) return user;
  const label = memberLabels[user.id]?.trim();
  return label && label !== user.id ? { ...user, displayName: label } : user;
}

/** Display name for a uid: real user name, else member label, else undefined. */
export function resolveOwnerDisplayName(
  uid: string,
  users: readonly Pick<User, "id" | "displayName">[],
  memberLabels: Readonly<Record<string, string>>,
): string | undefined {
  const id = uid?.trim();
  if (!id) return undefined;
  const user = users.find((u) => u.id === id);
  if (user && hasRealDisplayName(user)) return user.displayName.trim();
  return memberLabels[id]?.trim() || user?.displayName?.trim() || undefined;
}
