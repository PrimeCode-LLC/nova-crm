import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { ownerManagerIdsFromUser } from "@/lib/crm-owner-managers";
import type { User } from "@/lib/types";

const BATCH_LIMIT = 400;

type OwnerScoped = {
  collection: string;
  ownerField: "ownerId" | "leadOwnerId" | "userId";
  managerField: "ownerManagerIds" | "leadOwnerManagerIds" | "userManagerIds";
};

const OWNER_SCOPED: OwnerScoped[] = [
  { collection: COLLECTIONS.leads, ownerField: "ownerId", managerField: "ownerManagerIds" },
  { collection: COLLECTIONS.accounts, ownerField: "ownerId", managerField: "ownerManagerIds" },
  { collection: COLLECTIONS.contacts, ownerField: "ownerId", managerField: "ownerManagerIds" },
  { collection: COLLECTIONS.deals, ownerField: "ownerId", managerField: "ownerManagerIds" },
  { collection: COLLECTIONS.followups, ownerField: "ownerId", managerField: "ownerManagerIds" },
  { collection: COLLECTIONS.followupPlans, ownerField: "ownerId", managerField: "ownerManagerIds" },
  { collection: COLLECTIONS.profiles, ownerField: "ownerId", managerField: "ownerManagerIds" },
  { collection: COLLECTIONS.notes, ownerField: "leadOwnerId", managerField: "leadOwnerManagerIds" },
  { collection: COLLECTIONS.touchpoints, ownerField: "leadOwnerId", managerField: "leadOwnerManagerIds" },
  {
    collection: COLLECTIONS.timelineEvents,
    ownerField: "leadOwnerId",
    managerField: "leadOwnerManagerIds",
  },
  {
    collection: COLLECTIONS.activityCounters,
    ownerField: "userId",
    managerField: "userManagerIds",
  },
  {
    collection: COLLECTIONS.activityRecords,
    ownerField: "userId",
    managerField: "userManagerIds",
  },
];

/**
 * Re-stamp denormalized manager id arrays on CRM docs owned by `ownerIds`
 * (after hierarchy changes). Scoped to one organization.
 */
export async function restampOwnerManagerIdsForOwners(input: {
  db: Firestore;
  organizationId: string;
  /** Owner / leadOwner / activity user ids whose manager chain changed. */
  ownerIds: string[];
  /** Optional preloaded users for manager id resolution. */
  usersById?: Map<string, Pick<User, "managerId" | "managerAncestorIds">>;
}): Promise<{ updated: number }> {
  const { db, organizationId } = input;
  const ownerIds = [...new Set(input.ownerIds.map((id) => id.trim()).filter(Boolean))];
  if (!ownerIds.length) return { updated: 0 };

  const usersById = input.usersById ?? new Map();
  const managerIdsByOwner = new Map<string, string[]>();

  for (const ownerId of ownerIds) {
    let profile = usersById.get(ownerId);
    if (!profile) {
      const snap = await db.collection(COLLECTIONS.users).doc(ownerId).get();
      if (snap.exists) {
        const data = snap.data() as Record<string, unknown>;
        profile = {
          managerId: typeof data.managerId === "string" ? data.managerId : undefined,
          managerAncestorIds: Array.isArray(data.managerAncestorIds)
            ? data.managerAncestorIds.filter((id): id is string => typeof id === "string")
            : undefined,
        };
      }
    }
    managerIdsByOwner.set(ownerId, ownerManagerIdsFromUser(profile));
  }

  let updated = 0;
  let batch = db.batch();
  let ops = 0;

  const flush = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  };

  for (const spec of OWNER_SCOPED) {
    for (const ownerId of ownerIds) {
      const managerIds = managerIdsByOwner.get(ownerId) ?? [];
      const snap = await db
        .collection(spec.collection)
        .where("organizationId", "==", organizationId)
        .where(spec.ownerField, "==", ownerId)
        .select()
        .get();

      for (const docSnap of snap.docs) {
        batch.update(docSnap.ref, {
          [spec.managerField]: managerIds,
        });
        ops += 1;
        updated += 1;
        if (ops >= BATCH_LIMIT) await flush();
      }
    }
  }

  await flush();
  return { updated };
}

/** Backfill all owners in an org (paginated by distinct owner queries is expensive; use user roster). */
export async function restampOwnerManagerIdsForOrgUsers(input: {
  db: Firestore;
  organizationId: string;
  users: Array<{ id: string } & Pick<User, "managerId" | "managerAncestorIds">>;
}): Promise<{ updated: number }> {
  const usersById = new Map(input.users.map((u) => [u.id, u]));
  return restampOwnerManagerIdsForOwners({
    db: input.db,
    organizationId: input.organizationId,
    ownerIds: input.users.map((u) => u.id),
    usersById,
  });
}
