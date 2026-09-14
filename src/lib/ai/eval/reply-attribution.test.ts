import { describe, expect, it } from "vitest";
import { attributeReplyToConfig } from "@/lib/ai/eval/reply-attribution";

describe("attributeReplyToConfig", () => {
  const t0 = new Date("2026-01-01T10:00:00Z");
  const t1 = new Date("2026-01-01T11:00:00Z");
  const t2 = new Date("2026-01-01T12:00:00Z");
  const replyAt = new Date("2026-01-01T13:00:00Z");

  it("attributes to the most recent prior send's config", () => {
    const configId = attributeReplyToConfig({
      leadId: "lead-1",
      replyAt,
      sentEvents: [
        { leadId: "lead-1", createdAt: t0, configId: "cfg-a" },
        { leadId: "lead-1", createdAt: t1, configId: "cfg-b" },
      ],
    });
    expect(configId).toBe("cfg-b");
  });

  it("ignores sends after the reply", () => {
    const configId = attributeReplyToConfig({
      leadId: "lead-1",
      replyAt: t1,
      sentEvents: [
        { leadId: "lead-1", createdAt: t0, configId: "cfg-a" },
        { leadId: "lead-1", createdAt: t2, configId: "cfg-b" },
      ],
    });
    expect(configId).toBe("cfg-a");
  });

  it("falls back to followup→config map when meta.configId missing", () => {
    const configId = attributeReplyToConfig({
      leadId: "lead-1",
      replyAt,
      sentEvents: [{ leadId: "lead-1", createdAt: t0, followupId: "fu-1" }],
      followupToConfig: new Map([["fu-1", "cfg-from-prov"]]),
    });
    expect(configId).toBe("cfg-from-prov");
  });

  it("returns null when no attributable send exists", () => {
    expect(
      attributeReplyToConfig({
        leadId: "lead-1",
        replyAt,
        sentEvents: [{ leadId: "lead-2", createdAt: t0, configId: "cfg-a" }],
      }),
    ).toBeNull();
  });

  it("prefers meta.configId over followup map", () => {
    const configId = attributeReplyToConfig({
      leadId: "lead-1",
      replyAt,
      sentEvents: [
        { leadId: "lead-1", createdAt: t0, followupId: "fu-1", configId: "cfg-meta" },
      ],
      followupToConfig: new Map([["fu-1", "cfg-map"]]),
    });
    expect(configId).toBe("cfg-meta");
  });
});
