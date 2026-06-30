import { viewerHasMailboxDelegationServer } from "@/lib/email/mailbox-delegation-server";
import { getMemberServer } from "@/lib/platform/members-server";
import {
  listOrgUsersServer,
  viewerManagesUserServer,
} from "@/lib/platform/hierarchy-access-server";
import { roleAtLeast } from "@/lib/platform/org-role";
import type { OrgMemberRole } from "@/lib/types";

export type MailboxAccessPermission = "view" | "send" | "manage_settings";

export type MailboxAccessResolved = {
  ok: true;
  dataOwnerUid: string;
  viewerIsMailboxOwner: boolean;
  permissions: MailboxAccessPermission[];
};

function allMailboxPermissions(): MailboxAccessPermission[] {
  return ["view", "send", "manage_settings"];
}

export function canMailboxView(resolved: MailboxAccessResolved): boolean {
  return resolved.permissions.includes("view");
}

export function canMailboxSend(resolved: MailboxAccessResolved): boolean {
  return resolved.permissions.includes("send");
}

export function mailboxReadOnlyForClient(resolved: MailboxAccessResolved): boolean {
  return !canMailboxSend(resolved);
}

export async function resolveMailboxDataOwnerUid(input: {
  organizationId: string;
  viewerUid: string;
  viewerRole: OrgMemberRole;
  forUserParam: string | null | undefined;
}): Promise<MailboxAccessResolved | { ok: false; status: number; error: string }> {
  const self = input.viewerUid;
  const requested = (input.forUserParam ?? "").trim();
  const dataOwnerUid = requested && requested !== self ? requested : self;

  if (dataOwnerUid === self) {
    return {
      ok: true,
      dataOwnerUid: self,
      viewerIsMailboxOwner: true,
      permissions: allMailboxPermissions(),
    };
  }

  const member = await getMemberServer(input.organizationId, dataOwnerUid);
  if (!member || member.status !== "active") {
    return {
      ok: false,
      status: 404,
      error: "That workspace member was not found.",
    };
  }

  let hasHierarchyView = false;
  if (roleAtLeast(input.viewerRole, "admin")) {
    hasHierarchyView = true;
  } else {
    const orgUsers = await listOrgUsersServer(input.organizationId);
    if (viewerManagesUserServer(input.viewerUid, dataOwnerUid, orgUsers)) {
      hasHierarchyView = true;
    }
  }

  const hasDelegatedSend = await viewerHasMailboxDelegationServer({
    organizationId: input.organizationId,
    hostId: dataOwnerUid,
    viewerUid: input.viewerUid,
    permission: "send",
  });
  const hasDelegatedView = hasDelegatedSend
    ? true
    : await viewerHasMailboxDelegationServer({
        organizationId: input.organizationId,
        hostId: dataOwnerUid,
        viewerUid: input.viewerUid,
        permission: "view",
      });

  if (hasDelegatedSend) {
    return {
      ok: true,
      dataOwnerUid,
      viewerIsMailboxOwner: false,
      permissions: ["view", "send"],
    };
  }

  if (hasHierarchyView || hasDelegatedView) {
    return {
      ok: true,
      dataOwnerUid,
      viewerIsMailboxOwner: false,
      permissions: ["view"],
    };
  }

  return {
    ok: false,
    status: 403,
    error: "You can only open your own mailbox or one shared with you by a teammate.",
  };
}
