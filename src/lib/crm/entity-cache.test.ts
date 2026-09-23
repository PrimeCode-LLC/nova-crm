import { describe, expect, it } from "vitest";

import { peekCrmEntity, rememberCrmEntities } from "@/lib/crm/entity-cache";
import type { Lead } from "@/lib/types";

describe("crm entity cache", () => {
  it("returns a remembered lead by id and misses unknown ids", () => {
    const lead = { id: "lead-cache-1", contactName: "Ada" } as Lead;
    expect(peekCrmEntity("leads", "lead-cache-1")).toBeUndefined();
    rememberCrmEntities("leads", [lead]);
    expect(peekCrmEntity("leads", "lead-cache-1")?.contactName).toBe("Ada");
    expect(peekCrmEntity("leads", "missing")).toBeUndefined();
  });
});
