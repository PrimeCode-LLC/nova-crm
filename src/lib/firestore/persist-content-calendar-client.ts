import {
  deleteDoc,
  deleteField,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { stripUndefined } from "@/lib/firestore/strip-undefined";
import type {
  ContentBrand,
  ContentCapture,
  ContentItem,
  ContentPlan,
} from "@/lib/content-calendar/types";

export async function persistContentBrandCreate(
  db: Firestore,
  organizationId: string,
  brand: ContentBrand,
): Promise<void> {
  await setDoc(
    doc(db, COLLECTIONS.contentBrands, brand.id),
    stripUndefined({ ...brand, organizationId }) as Record<string, unknown>,
  );
}

export async function persistContentBrandUpdate(
  db: Firestore,
  brandId: string,
  patch: Partial<ContentBrand>,
): Promise<void> {
  const { id: _id, organizationId: _org, createdAt: _c, ...rest } = patch;
  await updateDoc(doc(db, COLLECTIONS.contentBrands, brandId), {
    ...stripUndefined(rest as Record<string, unknown>),
    updatedAt: serverTimestamp(),
  });
}

export async function persistContentBrandDelete(db: Firestore, brandId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.contentBrands, brandId));
}

export async function persistContentItemCreate(
  db: Firestore,
  organizationId: string,
  item: ContentItem,
): Promise<void> {
  await setDoc(
    doc(db, COLLECTIONS.contentItems, item.id),
    stripUndefined({ ...item, organizationId }) as Record<string, unknown>,
  );
}

export async function persistContentItemUpdate(
  db: Firestore,
  itemId: string,
  patch: Partial<ContentItem> & { completedAt?: string | null },
): Promise<void> {
  const { id: _id, organizationId: _org, createdAt: _c, completedAt, ...rest } = patch;
  const payload: Record<string, unknown> = {
    ...stripUndefined(rest as Record<string, unknown>),
    updatedAt: serverTimestamp(),
  };
  if (completedAt === null) payload.completedAt = deleteField();
  else if (completedAt !== undefined) payload.completedAt = completedAt;
  await updateDoc(doc(db, COLLECTIONS.contentItems, itemId), payload);
}

export async function persistContentItemDelete(db: Firestore, itemId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.contentItems, itemId));
}

export async function persistContentCaptureCreate(
  db: Firestore,
  organizationId: string,
  capture: ContentCapture,
): Promise<void> {
  await setDoc(
    doc(db, COLLECTIONS.contentCaptures, capture.id),
    stripUndefined({ ...capture, organizationId }) as Record<string, unknown>,
  );
}

export async function persistContentCaptureUpdate(
  db: Firestore,
  captureId: string,
  patch: Partial<ContentCapture> & { errorMessage?: string | null },
): Promise<void> {
  const { id: _id, organizationId: _org, createdAt: _c, errorMessage, ...rest } = patch;
  const payload: Record<string, unknown> = {
    ...stripUndefined(rest as Record<string, unknown>),
    updatedAt: serverTimestamp(),
  };
  if (errorMessage === null) {
    payload.errorMessage = deleteField();
  } else if (typeof errorMessage === "string") {
    payload.errorMessage = errorMessage;
  }
  await updateDoc(doc(db, COLLECTIONS.contentCaptures, captureId), payload);
}

export async function persistContentCaptureDelete(
  db: Firestore,
  captureId: string,
): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.contentCaptures, captureId));
}

export async function persistContentPlanCreate(
  db: Firestore,
  organizationId: string,
  plan: ContentPlan,
): Promise<void> {
  await setDoc(
    doc(db, COLLECTIONS.contentPlans, plan.id),
    stripUndefined({ ...plan, organizationId }) as Record<string, unknown>,
  );
}

export async function persistContentPlanUpdate(
  db: Firestore,
  planId: string,
  patch: Partial<ContentPlan>,
): Promise<void> {
  const { id: _id, organizationId: _org, createdAt: _c, ...rest } = patch;
  await updateDoc(doc(db, COLLECTIONS.contentPlans, planId), {
    ...stripUndefined(rest as Record<string, unknown>),
    updatedAt: serverTimestamp(),
  });
}
