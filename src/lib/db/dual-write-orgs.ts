/**
 * Organization + member Postgres upserts (P7 — sole writer helpers).
 */

import type { Prisma } from "@/generated/prisma/client";
import { Prisma as PrismaNamespace } from "@/generated/prisma/client";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { withRlsBypass } from "@/lib/db/tenant-scope";
import type { Organization, OrganizationMember } from "@/lib/types";

function toDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toJson(
  value: unknown,
): Prisma.InputJsonValue | typeof PrismaNamespace.JsonNull {
  if (value === null || value === undefined) return PrismaNamespace.JsonNull;
  return value as Prisma.InputJsonValue;
}

export function organizationToPrismaRow(
  org: Organization,
): Prisma.OrganizationUncheckedCreateInput {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    status: org.status,
    planId: org.planId,
    maxUsers: org.maxUsers ?? null,
    seatsUsed: org.seatsUsed ?? 0,
    ownerUid: org.ownerUid ?? null,
    primaryEmail: org.primaryEmail ?? null,
    pendingOwnerEmail: org.pendingOwnerEmail ?? null,
    trialEndsAt: toDate(org.trialEndsAt),
    settings: toJson(org.settings ?? {}),
    channelAdmin: toJson(org.channelAdmin),
    intakeFilterDefaults: toJson(org.intakeFilterDefaults),
    intakePoolEpoch: org.intakePoolEpoch ?? 1,
    intentPlaybook: toJson(org.intentPlaybook),
    openJoinTokenHash: org.openJoinTokenHash ?? null,
    createdAt: toDate(org.createdAt) ?? new Date(),
    updatedAt: toDate(org.updatedAt) ?? new Date(),
  };
}

export function memberToPrismaRow(
  member: OrganizationMember,
): Prisma.MemberUncheckedCreateInput {
  return {
    uid: member.uid,
    organizationId: member.organizationId,
    email: member.email.toLowerCase(),
    displayName: member.displayName,
    role: member.role,
    status: member.status,
    invitedByUid: member.invitedByUid,
    joinedAt: toDate(member.joinedAt) ?? new Date(),
    disabledAt: toDate(member.disabledAt),
  };
}

export async function upsertOrganizationMirror(org: Organization): Promise<void> {
  const row = organizationToPrismaRow(org);
  await withRlsBypass(async (tx) => {
    await tx.organization.upsert({
      where: { id: org.id },
      create: row,
      update: {
        name: row.name,
        slug: row.slug,
        status: row.status,
        planId: row.planId,
        maxUsers: row.maxUsers,
        seatsUsed: row.seatsUsed,
        ownerUid: row.ownerUid,
        primaryEmail: row.primaryEmail,
        pendingOwnerEmail: row.pendingOwnerEmail,
        trialEndsAt: row.trialEndsAt,
        settings: row.settings,
        channelAdmin: row.channelAdmin,
        intakeFilterDefaults: row.intakeFilterDefaults,
        intakePoolEpoch: row.intakePoolEpoch,
        intentPlaybook: row.intentPlaybook,
        openJoinTokenHash: row.openJoinTokenHash,
        updatedAt: row.updatedAt,
      },
    });
  });
}

export async function upsertMemberMirror(member: OrganizationMember): Promise<void> {
  const row = memberToPrismaRow(member);
  await withRlsBypass(async (tx) => {
    await tx.member.upsert({
      where: {
        organizationId_uid: {
          organizationId: member.organizationId,
          uid: member.uid,
        },
      },
      create: row,
      update: {
        email: row.email,
        displayName: row.displayName,
        role: row.role,
        status: row.status,
        invitedByUid: row.invitedByUid,
        disabledAt: row.disabledAt,
      },
    });
  });
}

export async function deleteMemberMirror(
  organizationId: string,
  uid: string,
): Promise<void> {
  await withRlsBypass(async (tx) => {
    await tx.member.deleteMany({
      where: { organizationId, uid },
    });
  });
}

export async function mirrorOrganizationAfterWrite(orgId: string): Promise<void> {
  if (!isDatabaseConfigured()) return;
  try {
    const { getOrganizationServer } = await import(
      "@/lib/platform/organizations-server"
    );
    const org = await getOrganizationServer(orgId);
    if (!org) return;
    await upsertOrganizationMirror(org);
  } catch (err) {
    console.error(
      "[org-sync] organization mirror failed",
      orgId,
      err instanceof Error ? err.message : err,
    );
  }
}

export async function mirrorMemberAfterWrite(
  orgId: string,
  uid: string,
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  try {
    const { getMemberServer } = await import("@/lib/platform/members-server");
    const member = await getMemberServer(orgId, uid);
    if (!member) return;
    await upsertMemberMirror(member);
  } catch (err) {
    console.error(
      "[org-sync] member mirror failed",
      orgId,
      uid,
      err instanceof Error ? err.message : err,
    );
  }
}

export async function mirrorMemberDeleteAfterWrite(
  orgId: string,
  uid: string,
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  try {
    await deleteMemberMirror(orgId, uid);
  } catch (err) {
    console.error(
      "[org-sync] member delete mirror failed",
      orgId,
      uid,
      err instanceof Error ? err.message : err,
    );
  }
}
