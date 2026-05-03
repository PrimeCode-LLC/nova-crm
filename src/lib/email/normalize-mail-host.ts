/**
 * Turn pasted mail server values (often URLs) into a DNS hostname for SMTP/IMAP.
 * e.g. "http://amsr200.websitehostserver.net/" → "amsr200.websitehostserver.net"
 */
export function normalizeMailHost(raw: string): string {
  let h = raw.trim();
  if (!h) return "";

  h = h.replace(/^https?:\/\//i, "");
  h = h.split("/")[0] ?? "";
  h = h.split("?")[0] ?? "";
  h = h.split("#")[0] ?? "";
  h = h.trim().replace(/\.+$/, "");

  const at = h.lastIndexOf("@");
  if (at !== -1) {
    h = h.slice(at + 1).trim();
  }

  return h.replace(/\.+$/, "").trim();
}
