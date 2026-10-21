import { describe, expect, it } from "vitest";

import { injectMailTracking } from "@/lib/email/mail-tracking-inject";
import { plainTextToEmailHtml } from "@/lib/email/plain-text-email-html";

describe("plainTextToEmailHtml (QA 2.6)", () => {
  it("escapes text and keeps one paragraph per line", () => {
    expect(plainTextToEmailHtml("Hi <b>Pat</b> & co\n\nBye")).toBe(
      "<p>Hi &lt;b&gt;Pat&lt;/b&gt; &amp; co</p><p><br/></p><p>Bye</p>",
    );
  });

  it("turns bare URLs into links without swallowing punctuation", () => {
    expect(plainTextToEmailHtml("See https://acme.test/pricing?a=1&b=2.")).toBe(
      '<p>See <a href="https://acme.test/pricing?a=1&amp;b=2">https://acme.test/pricing?a=1&amp;b=2</a>.</p>',
    );
    expect(plainTextToEmailHtml("Visit www.acme.test, thanks")).toBe(
      '<p>Visit <a href="https://www.acme.test">www.acme.test</a>, thanks</p>',
    );
  });

  it("cannot be used to inject markup through a URL", () => {
    const html = plainTextToEmailHtml('https://x.test/"onmouseover="alert(1)');
    expect(html).not.toContain('"onmouseover');
    expect(html).not.toContain("<script");
  });

  it("produces links the click tracker wraps (SEND-10)", () => {
    const { html, links } = injectMailTracking({
      html: plainTextToEmailHtml("Book here: https://acme.test/book"),
      trackingId: "t1",
      trackOpens: false,
      trackClicks: true,
    });
    expect(links).toEqual([expect.objectContaining({ url: "https://acme.test/book" })]);
    expect(html).not.toContain('href="https://acme.test/book"');
  });
});
