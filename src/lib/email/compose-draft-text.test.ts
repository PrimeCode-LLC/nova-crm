import { describe, expect, it } from "vitest";
import {
  composerHasUserDraft,
  mergeAiBodyIntoCompose,
  splitComposerReplyBody,
  stripLikelyComposeSignature,
} from "@/lib/email/compose-draft-text";

const signature = "Best,\nF. Clark\nSales Development | Stellix Soft";
const quote =
  "---\nOn 2026-07-31, Simas Didzbalis <sd@nutrioz.com> wrote:\nHi Barry,\nThank you for reaching out.";

describe("splitComposerReplyBody", () => {
  it("treats signature + quote as empty draft", () => {
    const body = `\n\n${signature}\n\n${quote}`;
    const split = splitComposerReplyBody(body);
    expect(split.userDraft).toBe("");
    expect(composerHasUserDraft(body)).toBe(false);
    expect(split.trail).toContain("---");
    expect(split.trail).toContain("F. Clark");
  });

  it("extracts user text above signature and quote", () => {
    const body = `Hi Simas, glad this resonated.\n\n${signature}\n\n${quote}`;
    const split = splitComposerReplyBody(body);
    expect(split.userDraft).toBe("Hi Simas, glad this resonated.");
    expect(composerHasUserDraft(body)).toBe(true);
  });

  it("merges AI body back with signature and quote", () => {
    const original = `Rough notes here\n\n${signature}\n\n${quote}`;
    const merged = mergeAiBodyIntoCompose("Polished reply for Simas.", original);
    expect(merged.startsWith("Polished reply for Simas.")).toBe(true);
    expect(merged).toContain("F. Clark");
    expect(merged).toContain("---");
    expect(merged).not.toContain("Rough notes here");
  });
});

describe("stripLikelyComposeSignature", () => {
  it("removes a Best, signature block", () => {
    expect(stripLikelyComposeSignature(`Hello there\n\n${signature}`)).toBe("Hello there");
  });
});
