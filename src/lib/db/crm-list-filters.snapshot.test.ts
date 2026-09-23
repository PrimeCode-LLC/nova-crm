import { describe, expect, it } from "vitest";

import { leadListFilterWhere, parseLeadListFilters } from "@/lib/db/crm-list-filters";

describe("lead list filters added for snapshot cutover", () => {
  it("omits new predicates when the query does not ask for them", () => {
    const parsed = parseLeadListFilters(new URL("https://example.test/api/org/leads?q=acme"));
    expect(parsed?.accountId).toBeUndefined();
    expect(parsed?.contactId).toBeUndefined();
    expect(parsed?.campaignId).toBeUndefined();
    expect(parsed?.ids).toBeUndefined();
    expect(parsed?.repliedSince).toBeUndefined();
    expect(parsed?.createdSince).toBeUndefined();
    expect(parsed?.replyReviewStatus).toBeUndefined();
    expect(parsed?.replyActionStatus).toBeUndefined();
    expect(parsed?.companyNameExact).toBeUndefined();
    expect(parsed?.companyDomain).toBeUndefined();
    expect(leadListFilterWhere(parsed)).toEqual(leadListFilterWhere({ q: "acme" }));
    expect(JSON.stringify(leadListFilterWhere(parsed))).not.toContain("replyReviewStatus");
    expect(JSON.stringify(leadListFilterWhere(parsed))).not.toContain("companyNameExact");
    expect(JSON.stringify(leadListFilterWhere(parsed))).not.toContain("companyDomain");
  });

  it("adds account, campaign, and id predicates only when requested", () => {
    const parsed = parseLeadListFilters(
      new URL(
        "https://example.test/api/org/leads?accountId=acct-1&campaignId=camp-1&ids=lead-1,lead-2",
      ),
    );
    const where = leadListFilterWhere(parsed);
    expect(where).toMatchObject({
      AND: expect.arrayContaining([
        { accountId: "acct-1" },
        { payload: { path: ["campaignId"], equals: "camp-1" } },
        { id: { in: ["lead-1", "lead-2"] } },
      ]),
    });
  });

  it("adds reply and exact-company predicates only when those params are set", () => {
    const parsed = parseLeadListFilters(
      new URL(
        "https://example.test/api/org/leads?replyReviewStatus=pending&replyActionStatus=pending&companyNameExact=Acme&companyDomain=acme.example",
      ),
    );
    expect(leadListFilterWhere(parsed)).toMatchObject({
      AND: expect.arrayContaining([
        { payload: { path: ["replyReviewStatus"], equals: "pending" } },
        { payload: { path: ["replyActionStatus"], equals: "pending" } },
        { companyName: { equals: "Acme", mode: "insensitive" } },
        { payload: { path: ["companyDomain"], equals: "acme.example" } },
      ]),
    });
  });

  it("lets companyNameExact own the company column when q is also set", () => {
    const where = leadListFilterWhere({ q: "acme", companyNameExact: "Acme Robotics" });
    expect(where).toMatchObject({
      AND: expect.arrayContaining([
        { companyName: { equals: "Acme Robotics", mode: "insensitive" } },
        { OR: [{ contactName: { contains: "acme", mode: "insensitive" } }] },
      ]),
    });
    const companyContains = JSON.stringify(where).includes('"contains":"acme"');
    const serialized = JSON.stringify(where);
    expect(serialized).not.toContain('"companyName":{"contains"');
    expect(companyContains).toBe(true);
  });
});
