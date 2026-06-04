import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { Profile } from "@/lib/types";
import {
  OPPORTUNITY_SOURCE_TYPES,
  type OpportunitySourceType,
} from "@/lib/ai/opportunity-fit-types";
import {
  filterProfilesForFitSource,
  profileDisplayLabel,
  profileFitCategories,
} from "@/lib/ai/profile-fit-check";

function mapProfile(id: string, raw: Record<string, unknown>): Profile {
  const fitRaw = raw.fitCheckCategories;
  const fitCheckCategories = Array.isArray(fitRaw)
    ? fitRaw.filter((c): c is OpportunitySourceType =>
        typeof c === "string" && (OPPORTUNITY_SOURCE_TYPES as readonly string[]).includes(c),
      )
    : undefined;

  const libRaw = raw.knowledgeLibraryIds;
  const knowledgeLibraryIds = Array.isArray(libRaw)
    ? libRaw.filter((id): id is string => typeof id === "string" && id.length > 0)
    : undefined;

  const docRaw = raw.knowledgeDocumentIds;
  const knowledgeDocumentIds = Array.isArray(docRaw)
    ? docRaw.filter((id): id is string => typeof id === "string" && id.length > 0)
    : undefined;

  return {
    id,
    name: String(raw.name ?? ""),
    channel: (raw.channel as Profile["channel"]) ?? "cold_email",
    ownerId: String(raw.ownerId ?? ""),
    active: raw.active !== false,
    notes: typeof raw.notes === "string" ? raw.notes : undefined,
    stackLabel: typeof raw.stackLabel === "string" ? raw.stackLabel : undefined,
    fitCheckCategories: fitCheckCategories?.length ? fitCheckCategories : undefined,
    knowledgeLibraryIds: knowledgeLibraryIds?.length ? knowledgeLibraryIds : undefined,
    knowledgeDocumentIds: knowledgeDocumentIds?.length ? knowledgeDocumentIds : undefined,
  };
}

export async function getProfileServer(input: {
  profileId: string;
  organizationId: string;
}): Promise<Profile | null> {
  const db = getAdminDb();
  if (!db) return null;

  const snap = await db.collection(COLLECTIONS.profiles).doc(input.profileId).get();
  if (!snap.exists) return null;

  const data = snap.data()!;
  if (String(data.organizationId ?? "") !== input.organizationId) return null;
  return mapProfile(snap.id, data);
}

export async function listProfilesForOrganizationServer(
  organizationId: string,
): Promise<Profile[]> {
  const db = getAdminDb();
  if (!db) return [];

  const snap = await db
    .collection(COLLECTIONS.profiles)
    .where("organizationId", "==", organizationId)
    .get();

  return snap.docs.map((d) => mapProfile(d.id, d.data()));
}

export type FitCheckProfileOption = {
  id: string;
  name: string;
  displayLabel: string;
  stackLabel?: string;
  channel: Profile["channel"];
  knowledgeLibraryIds: string[];
  knowledgeDocumentIds: string[];
  fitCheckCategories: OpportunitySourceType[];
};

export async function listFitCheckProfileOptionsServer(input: {
  organizationId: string;
  sourceType: OpportunitySourceType;
}): Promise<FitCheckProfileOption[]> {
  const all = await listProfilesForOrganizationServer(input.organizationId);
  return filterProfilesForFitSource(all, input.sourceType).map((p) => ({
    id: p.id,
    name: p.name,
    displayLabel: profileDisplayLabel(p),
    stackLabel: p.stackLabel,
    channel: p.channel,
    knowledgeLibraryIds: p.knowledgeLibraryIds ?? [],
    knowledgeDocumentIds: p.knowledgeDocumentIds ?? [],
    fitCheckCategories: profileFitCategories(p),
  }));
}
