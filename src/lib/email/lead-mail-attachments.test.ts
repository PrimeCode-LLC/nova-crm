import { describe, expect, it } from "vitest";
import {
  outboundAttachmentsToLeadMail,
  pickLeadMailAttachments,
  sanitizeLeadMailAttachments,
} from "@/lib/email/lead-mail-attachments";

describe("sanitizeLeadMailAttachments", () => {
  it("keeps metadata when the file is too large to embed", () => {
    const huge = "a".repeat(200_000);
    const result = sanitizeLeadMailAttachments([
      {
        filename: "proposal.pdf",
        mimeType: "application/pdf",
        sizeBytes: 900_000,
        contentBase64: huge,
      },
    ]);
    expect(result).toEqual([
      {
        filename: "proposal.pdf",
        mimeType: "application/pdf",
        sizeBytes: 900_000,
      },
    ]);
  });

  it("embeds small files", () => {
    const contentBase64 = Buffer.from("hello").toString("base64");
    const result = sanitizeLeadMailAttachments([
      {
        filename: "note.txt",
        mimeType: "text/plain",
        sizeBytes: 5,
        contentBase64,
      },
    ]);
    expect(result?.[0]?.contentBase64).toBe(contentBase64);
  });
});

describe("outboundAttachmentsToLeadMail", () => {
  it("returns an empty list when nothing was attached", () => {
    expect(outboundAttachmentsToLeadMail([])).toEqual([]);
    expect(outboundAttachmentsToLeadMail(undefined)).toEqual([]);
  });

  it("maps outbound buffers into lead-mail attachments", () => {
    const result = outboundAttachmentsToLeadMail([
      { filename: "brief.pdf", content: Buffer.from("%PDF"), contentType: "application/pdf" },
    ]);
    expect(result?.[0]).toMatchObject({
      filename: "brief.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4,
    });
    expect(result?.[0]?.contentBase64).toBe(Buffer.from("%PDF").toString("base64"));
  });
});

describe("pickLeadMailAttachments", () => {
  it("prefers the copy that still has downloadable bytes", () => {
    const withBytes = [
      {
        filename: "proposal.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        contentBase64: Buffer.from("pdf-bytes").toString("base64"),
      },
    ];
    const metaOnly = [{ filename: "proposal.pdf", mimeType: "application/pdf", sizeBytes: 12 }];
    expect(pickLeadMailAttachments(metaOnly, withBytes)).toEqual(withBytes);
  });
});
