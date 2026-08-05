import { randomBytes } from "node:crypto";
import type { MailTrackingLink } from "@/lib/email/mail-tracking-types";
import {
  clickTrackingUrl,
  openTrackingUrl,
  signMailTrackingToken,
} from "@/lib/email/mail-tracking-token";

const HREF_RE = /href\s*=\s*(["'])(.*?)\1/gi;
const TRACKED_PATH_RE = /\/api\/t\/[oc]\//i;

function newLinkId(): string {
  return randomBytes(6).toString("hex");
}

function shouldRewriteHref(href: string): boolean {
  const value = href.trim();
  if (!value) return false;
  if (value.startsWith("#") || value.startsWith("mailto:") || value.startsWith("tel:")) {
    return false;
  }
  if (TRACKED_PATH_RE.test(value)) return false;
  if (/^javascript:/i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export type InjectMailTrackingResult = {
  html: string;
  links: MailTrackingLink[];
};

/**
 * Rewrite http(s) links and/or append an open pixel. Tokens are signed against `trackingId`.
 */
export function injectMailTracking(input: {
  html: string;
  trackingId: string;
  trackOpens: boolean;
  trackClicks: boolean;
  /** When set, open/click tokens are attributed to this recipient id. */
  recipientId?: string;
  /** Reuse stable link ids so every recipient copy tracks the same destinations. */
  links?: MailTrackingLink[];
}): InjectMailTrackingResult {
  let html = input.html;
  const reuseLinks = Array.isArray(input.links);
  const links: MailTrackingLink[] = reuseLinks ? [...(input.links ?? [])] : [];
  let linkIndex = 0;
  const recipientId = input.recipientId?.trim() || undefined;

  if (input.trackClicks && html.trim()) {
    html = html.replace(HREF_RE, (full, quote: string, href: string) => {
      if (!shouldRewriteHref(href)) return full;
      let link: MailTrackingLink | undefined;
      if (reuseLinks) {
        link = links[linkIndex++];
        if (!link?.id) return full;
      } else {
        link = { id: newLinkId(), url: href.trim() };
        links.push(link);
      }
      const token = signMailTrackingToken({
        t: "c",
        id: input.trackingId,
        l: link.id,
        ...(recipientId ? { r: recipientId } : {}),
      });
      if (!token) return full;
      return `href=${quote}${clickTrackingUrl(token)}${quote}`;
    });
  }

  if (input.trackOpens && html.trim()) {
    const token = signMailTrackingToken({
      t: "o",
      id: input.trackingId,
      ...(recipientId ? { r: recipientId } : {}),
    });
    if (token) {
      const pixel = `<img src="${openTrackingUrl(token)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />`;
      if (/<\/body>/i.test(html)) {
        html = html.replace(/<\/body>/i, `${pixel}</body>`);
      } else {
        html = `${html}${pixel}`;
      }
    }
  }

  return { html, links };
}
