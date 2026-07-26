import { describe, expect, it } from "vitest";
import { sortLibrariesForCapturePerson } from "@/lib/content-calendar/capture-prefs";

describe("sortLibrariesForCapturePerson", () => {
  it("puts last used and preferred libraries first, then brand-linked", () => {
    const libs = [
      { id: "c", name: "C" },
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "d", name: "D" },
    ];
    const sorted = sortLibrariesForCapturePerson(
      libs,
      { lastLibraryId: "b", preferredLibraryIds: ["d", "b"] },
      ["a"],
    );
    expect(sorted.map((l) => l.id)).toEqual(["b", "d", "a", "c"]);
  });
});
