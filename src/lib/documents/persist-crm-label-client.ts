import { deleteDoc, deleteField, doc, serverTimestamp, setDoc, updateDoc } from "@/lib/db/document-shim/shim-client-firestore";
import type { Firestore } from "@/lib/db/document-shim/shim-client-firestore";
import { COLLECTIONS } from "@/lib/documents/collections";
import type { CrmLabel } from "@/lib/types";

export async function persistCrmLabelCreate(
  db: Firestore,
  organizationId: string,
  label: CrmLabel,
): Promise<void> {
  const data: Record<string, unknown> = {
    organizationId,
    name: label.name.trim(),
    createdAt: label.createdAt,
    updatedAt: label.updatedAt,
  };
  if (label.color?.trim()) data.color = label.color.trim();
  await setDoc(doc(db, COLLECTIONS.labels, label.id), data);
}

export async function persistCrmLabelUpdate(
  db: Firestore,
  labelId: string,
  patch: Partial<Pick<CrmLabel, "name" | "color">>,
): Promise<void> {
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.name !== undefined) payload.name = patch.name.trim();
  if (patch.color !== undefined) {
    const c = patch.color?.trim();
    if (c) payload.color = c;
    else payload.color = deleteField();
  }
  await updateDoc(doc(db, COLLECTIONS.labels, labelId), payload);
}

export async function persistCrmLabelDelete(db: Firestore, labelId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.labels, labelId));
}
