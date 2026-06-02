import { getMemberServer } from "@/lib/platform/members-server";
import {
  listOrgUsersServer,
  viewerManagesUserServer,
} from "@/lib/platform/hierarchy-access-server";
import { roleAtLeast } from "@/lib/platform/org-role";
import type { OrgMemberRole } from "@/lib/types";

export async function resolveMailboxDataOwnerUid(input: {
  organizationId: string;
  viewerUid: string;
  viewerRole: OrgMemberRole;
  forUserParam: string | null | undefined;
}): Promise<
  | { ok: true; dataOwnerUid: string; viewerIsMailboxOwner: boolean }
  | { ok: false; status: number; error: string }
> {
  const self = input.viewerUid;
  const requested = (input.forUserParam ?? "").trim();
  const dataOwnerUid = requested && requested !== self ? requested : self;

  if (dataOwnerUid === self) {
    return { ok: true, dataOwnerUid: self, viewerIsMailboxOwner: true };
  }

  if (!roleAtLeast(input.viewerRole, "admin")) {
    const orgUsers = await listOrgUsersServer(input.organizationId);
    if (!viewerManagesUserServer(input.viewerUid, dataOwnerUid, orgUsers)) {
      return {
        ok: false,
        status: 403,
        error: "You can only open your own mailbox or a direct/indirect report’s inbox.",
      };
    }
  }

  const member = await getMemberServer(input.organizationId, dataOwnerUid);
  if (!member || member.status !== "active") {
    return {
      ok: false,
      status: 404,
      error: "That workspace member was not found.",
    };
  }

  return { ok: true, dataOwnerUid, viewerIsMailboxOwner: false };
}
