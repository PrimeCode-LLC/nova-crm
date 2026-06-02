import type { DocumentData } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { listMembersServer } from "@/lib/platform/members-server";
import type { OrganizationMember } from "@/lib/types";

function labelFromUserDoc(data: DocumentData | undefined): string {
  if (!data) return "";
  const name = String(data.name ?? data.displayName ?? "").trim();
  const email = String(data.email ?? "").trim();
  return name || email;
}

export function memberDisplayLabel(
  member: Pick<OrganizationMember, "uid" | "displayName" | "email">,
  userProfile?: DocumentData,
): string {
  const fromMember =
    member.displayName?.trim() || member.email?.trim() || "";
  if (fromMember) return fromMember;
  const fromUser = labelFromUserDoc(userProfile);
  if (fromUser) return fromUser;
  return member.email?.trim() || member.uid;
}

/** Org members with display labels resolved from the users collection when needed. */
export async function listMembersForDisplayServer(
  orgId: string,
): Promise<{ uid: string; label: string }[]> {
  const members = await listMembersServer(orgId);
  const db = getAdminDb();
  if (!db) {
    return members.map((m) => ({
      uid: m.uid,
      label: memberDisplayLabel(m),
    }));
  }

  const needsProfile = members.filter(
    (m) => !m.displayName?.trim() && !m.email?.trim(),
  );
  const profileByUid = new Map<string, DocumentData>();
  if (needsProfile.length > 0) {
    const snaps = await Promise.all(
      needsProfile.map((m) => db.collection(COLLECTIONS.users).doc(m.uid).get()),
    );
    for (const snap of snaps) {
      if (snap.exists) profileByUid.set(snap.id, snap.data()!);
    }
  }

  return members.map((m) => ({
    uid: m.uid,
    label: memberDisplayLabel(m, profileByUid.get(m.uid)),
  }));
}
