import type { User } from "@/lib/types";
import { collectDescendantUserIds } from "@/lib/workspace-hierarchy";

/** All manager user IDs above `userId` in the org chart (direct manager first). */
export function computeManagerAncestorIds(
  userId: string,
  users: readonly User[],
): string[] {
  const byId = new Map(users.map((u) => [u.id, u]));
  const ancestors: string[] = [];
  const seen = new Set<string>();
  let mid = byId.get(userId)?.managerId;
  while (mid && !seen.has(mid)) {
    seen.add(mid);
    ancestors.push(mid);
    mid = byId.get(mid)?.managerId;
  }
  return ancestors;
}

/** Recompute `managerAncestorIds` for every user in the roster (after hierarchy edits). */
export function buildOrgManagerAncestorIdsMap(
  users: readonly User[],
): Map<string, string[]> {
  return new Map(users.map((u) => [u.id, computeManagerAncestorIds(u.id, users)]));
}

export type HierarchyNode = {
  user: User;
  children: HierarchyNode[];
};

/** Users whose `managerId` is set but does not match anyone in `users` (excluding self-reference). */
export function usersWithBrokenManagerLink(users: readonly User[]): User[] {
  const ids = new Set(users.map((u) => u.id));
  return users.filter((u) => {
    if (!u.managerId) return false;
    if (u.managerId === u.id) return true;
    return !ids.has(u.managerId);
  });
}

/** True if assigning `newManagerId` to `userId` would create a cycle in the manager graph. */
export function managerAssignmentCreatesCycle(
  users: readonly User[],
  userId: string,
  newManagerId: string | undefined,
): boolean {
  if (!newManagerId) return false;
  if (newManagerId === userId) return true;
  const descendants = collectDescendantUserIds(userId, users);
  return descendants.has(newManagerId);
}

function sortByDisplayName(a: User, b: User): number {
  return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
}

function hasValidManagerInRoster(u: User, idSet: Set<string>): boolean {
  const mid = u.managerId;
  return Boolean(mid && mid !== u.id && idSet.has(mid));
}

function classUnion(parent: Map<string, string>, a: string, b: string) {
  const ra = classFind(parent, a);
  const rb = classFind(parent, b);
  if (ra !== rb) parent.set(ra, rb);
}

function classFind(parent: Map<string, string>, x: string): string {
  let p = parent.get(x) ?? x;
  if (p !== x) {
    p = classFind(parent, p);
    parent.set(x, p);
  }
  return p;
}

/**
 * Builds reporting-line trees: each user appears exactly once.
 * Natural roots: no valid manager in the roster.
 * Synthetic roots: users not reachable from any natural root (manager cycles, etc.) — one anchor per weak component.
 */
export function buildHierarchyForest(users: readonly User[]): {
  roots: HierarchyNode[];
  brokenManagerLinks: User[];
  cycleOrphans: User[];
} {
  const brokenManagerLinks = usersWithBrokenManagerLink(users);
  const brokenSet = new Set(brokenManagerLinks.map((u) => u.id));
  const idSet = new Set(users.map((u) => u.id));

  const childrenByManager = new Map<string, User[]>();
  for (const u of users) {
    const mid = u.managerId;
    if (!mid || mid === u.id || !idSet.has(mid) || brokenSet.has(u.id)) continue;
    const list = childrenByManager.get(mid);
    if (list) list.push(u);
    else childrenByManager.set(mid, [u]);
  }

  for (const [, list] of childrenByManager) {
    list.sort(sortByDisplayName);
  }

  const naturalRoots = users.filter((u) => !hasValidManagerInRoster(u, idSet) || brokenSet.has(u.id));
  const reachable = new Set<string>();
  const stack = naturalRoots.map((u) => u.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const c of childrenByManager.get(id) ?? []) stack.push(c.id);
  }

  const unreachable = users.filter((u) => !reachable.has(u.id));
  const parentMap = new Map<string, string>();
  for (const u of unreachable) parentMap.set(u.id, u.id);
  for (const u of unreachable) {
    const mid = u.managerId;
    if (mid && idSet.has(mid) && unreachable.some((x) => x.id === mid)) {
      classUnion(parentMap, u.id, mid);
    }
  }
  const componentMin = new Map<string, string>();
  for (const u of unreachable) {
    const root = classFind(parentMap, u.id);
    const prev = componentMin.get(root);
    if (!prev || u.id < prev) componentMin.set(root, u.id);
  }
  const syntheticRootIds = new Set(componentMin.values());
  const syntheticRoots = users.filter((u) => syntheticRootIds.has(u.id));

  const cycleOrphans = unreachable;
  const rootUsersMap = new Map<string, User>();
  for (const u of naturalRoots) rootUsersMap.set(u.id, u);
  for (const u of syntheticRoots) rootUsersMap.set(u.id, u);
  const rootUsers = [...rootUsersMap.values()].sort(sortByDisplayName);

  function buildNode(u: User, ancestorStack: Set<string>): HierarchyNode {
    const nextStack = new Set(ancestorStack);
    nextStack.add(u.id);
    const rawKids = childrenByManager.get(u.id) ?? [];
    const kids = rawKids.filter((c) => !nextStack.has(c.id));
    return {
      user: u,
      children: kids.map((c) => buildNode(c, nextStack)),
    };
  }

  return {
    roots: rootUsers.map((u) => buildNode(u, new Set())),
    brokenManagerLinks,
    cycleOrphans,
  };
}

export function countHierarchyNodes(nodes: readonly HierarchyNode[]): number {
  let n = 0;
  const walk = (list: readonly HierarchyNode[]) => {
    for (const node of list) {
      n += 1;
      walk(node.children);
    }
  };
  walk(nodes);
  return n;
}
