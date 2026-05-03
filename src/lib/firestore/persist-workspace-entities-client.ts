import {
  deleteDoc,
  deleteField,
  doc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { Followup, Note, Touchpoint, TimelineEvent } from "@/lib/types";

export async function persistNoteCreate(
  db: Firestore,
  organizationId: string,
  note: Note,
): Promise<void> {
  await setDoc(doc(db, COLLECTIONS.notes, note.id), {
    organizationId,
    leadId: note.leadId ?? null,
    contactId: note.contactId ?? null,
    accountId: note.accountId ?? null,
    dealId: note.dealId ?? null,
    authorId: note.authorId,
    body: note.body,
    pinned: note.pinned ?? false,
    createdAt: note.createdAt,
  });
}

export async function persistNoteUpdate(
  db: Firestore,
  noteId: string,
  patch: Partial<Pick<Note, "body" | "pinned">>,
): Promise<void> {
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.body !== undefined) payload.body = patch.body;
  if (patch.pinned !== undefined) payload.pinned = patch.pinned;
  await updateDoc(doc(db, COLLECTIONS.notes, noteId), payload);
}

export async function persistNoteDelete(db: Firestore, noteId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.notes, noteId));
}

export async function persistFollowupCreate(
  db: Firestore,
  organizationId: string,
  f: Followup,
): Promise<void> {
  await setDoc(doc(db, COLLECTIONS.followups, f.id), {
    organizationId,
    leadId: f.leadId ?? null,
    dealId: f.dealId ?? null,
    contactId: f.contactId ?? null,
    title: f.title,
    description: f.description ?? null,
    dueAt: f.dueAt,
    completedAt: f.completedAt ?? null,
    ownerId: f.ownerId,
    priority: f.priority,
    auto: f.auto,
  });
}

export async function persistFollowupSetCompleted(
  db: Firestore,
  followupId: string,
  completed: boolean,
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.followups, followupId), {
    completedAt: completed ? serverTimestamp() : deleteField(),
    updatedAt: serverTimestamp(),
  });
}

export async function persistTouchpointCreate(
  db: Firestore,
  organizationId: string,
  t: Touchpoint,
): Promise<void> {
  await setDoc(doc(db, COLLECTIONS.touchpoints, t.id), {
    organizationId,
    leadId: t.leadId,
    channel: t.channel,
    state: t.state,
    stepNumber: t.stepNumber ?? null,
    occurredAt: t.occurredAt,
    actorId: t.actorId ?? null,
    summary: t.summary ?? null,
    payload: t.payload ?? null,
  });
}

export async function persistTimelineEventCreate(
  db: Firestore,
  organizationId: string,
  e: TimelineEvent,
): Promise<void> {
  await setDoc(doc(db, COLLECTIONS.timelineEvents, e.id), {
    organizationId,
    leadId: e.leadId,
    type: e.type,
    actorId: e.actorId ?? null,
    summary: e.summary,
    payload: e.payload ?? null,
    createdAt: e.createdAt,
  });
}

export async function persistLeadActivityBump(db: Firestore, leadId: string): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.leads, leadId), {
    touches: increment(1),
    lastActivityAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
