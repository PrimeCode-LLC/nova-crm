import { describe, expect, it } from "vitest";
import {
  projectWorkspaceListPayload,
  serializePayloadValue,
  Timestamp,
} from "@/lib/db/document-shim/timestamp";

describe("workspace-documents edge serialization", () => {
  it("serializes bigint without throwing", () => {
    expect(serializePayloadValue({ n: BigInt(10) })).toEqual({ n: "10" });
  });

  it("serializes nested Invalid Date to null", () => {
    expect(
      serializePayloadValue({
        createdAt: new Date("nope"),
        nested: { dueAt: Timestamp.fromDate(new Date("also-nope")) },
      }),
    ).toEqual({
      createdAt: null,
      nested: { dueAt: null },
    });
  });

  it("does not treat whitespace messageBody as present", () => {
    const projected = projectWorkspaceListPayload({
      messageBody: "   \n\t  ",
      title: "x",
    });
    expect(projected.messageBody).toBeUndefined();
    expect(projected.hasMessageBody).toBeUndefined();
  });

  it("preserves hasMessageBody when body is omitted already", () => {
    const projected = projectWorkspaceListPayload({
      hasMessageBody: true,
      title: "x",
    });
    expect(projected.hasMessageBody).toBe(true);
    expect(projected.messageBody).toBeUndefined();
  });
});
