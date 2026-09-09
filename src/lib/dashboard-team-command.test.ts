import { describe, expect, it } from "vitest";
import { buildTeamCommandRows } from "@/lib/dashboard-team-command";
import type { Deal, Followup, Lead, LeadTask, User } from "@/lib/types";

function user(partial: Partial<User> & Pick<User, "id" | "roleId">): User {
  return {
    name: partial.name ?? partial.id,
    email: `${partial.id}@example.com`,
    status: "active",
    organizationId: "org_1",
    ...partial,
  } as User;
}

function prospect(partial: Partial<Lead> & Pick<Lead, "id">): Lead {
  return {
    organizationId: "org_1",
    accountId: "a1",
    contactId: "c1",
    channel: "cold_email",
    stage: "new",
    temperature: "cold",
    priority: "medium",
    ownerId: partial.ownerId ?? "",
    contactName: "P",
    companyName: "Co",
    intakeKind: "prospect",
    createdAt: "2026-09-08T12:00:00.000Z",
    updatedAt: "2026-09-08T12:00:00.000Z",
    ...partial,
  } as Lead;
}

describe("buildTeamCommandRows prospect attribution", () => {
  const now = new Date("2026-09-09T12:00:00.000Z");
  const empty = {
    deals: [] as Deal[],
    followups: [] as Followup[],
    tasks: [] as LeadTask[],
    range: "30d" as const,
    outreachThreshold: 45,
    now,
  };

  it("excludes directors even when they own prospects", () => {
    const rows = buildTeamCommandRows({
      ...empty,
      users: [
        user({ id: "dir_1", roleId: "director", name: "Director" }),
        user({ id: "rep_1", roleId: "sdr", name: "Rep" }),
      ],
      leads: [
        prospect({
          id: "p1",
          ownerId: "dir_1",
          createdById: "dir_1",
          prospectOwnerId: "dir_1",
        }),
      ],
    });
    expect(rows).toEqual([]);
  });

  it("credits a non-director via ownerId when other attr fields are missing", () => {
    const rows = buildTeamCommandRows({
      ...empty,
      users: [
        user({ id: "dir_1", roleId: "director", name: "Director" }),
        user({ id: "rep_1", roleId: "sdr", name: "Rep" }),
      ],
      leads: [
        prospect({
          id: "p1",
          ownerId: "rep_1",
          // Import/update paths often leave these unset.
          createdById: undefined,
          scraperId: undefined,
          prospectOwnerId: undefined,
        }),
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe("rep_1");
    expect(rows[0]?.prospectsAdded).toBe(1);
  });

  it("still credits createdById / prospectOwnerId for non-directors", () => {
    const rows = buildTeamCommandRows({
      ...empty,
      users: [user({ id: "rep_1", roleId: "sdr", name: "Rep" })],
      leads: [
        prospect({
          id: "p1",
          ownerId: "rep_1",
          createdById: "rep_1",
          prospectOwnerId: "rep_1",
        }),
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.prospectsAdded).toBe(1);
  });
});
