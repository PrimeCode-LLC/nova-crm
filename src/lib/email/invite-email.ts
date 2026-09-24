import { SITE } from "@/lib/site";

export type InviteEmailContext = {
  organizationName: string;
  inviterName?: string;
  recipientEmail: string;
  role: string;
  acceptUrl: string;
  expiresAt: string;
};

/**
 * Produces an HTML + plain-text body for a workspace invite. Designed to look
 * acceptable in Gmail / Outlook without external CSS or remote images.
 */
export function renderInviteEmail(ctx: InviteEmailContext): {
  subject: string;
  html: string;
  text: string;
} {
  const expires = new Date(ctx.expiresAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const inviter = ctx.inviterName ? ctx.inviterName : "Your teammate";
  const subject = `${inviter} invited you to ${ctx.organizationName} on ${SITE.name}`;

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#0b0b0c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e7e7ea;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0c;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#141416;border:1px solid #2a2a2e;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 8px 32px;">
                <div style="font-size:14px;color:#9b9ba1;letter-spacing:0.04em;text-transform:uppercase;">${escapeHtml(SITE.name)}</div>
                <h1 style="margin:8px 0 0 0;font-size:22px;font-weight:600;color:#fafafa;">You're invited to ${escapeHtml(ctx.organizationName)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 24px 32px;font-size:14px;line-height:1.55;color:#c9c9d0;">
                <p>${escapeHtml(inviter)} added you to <strong>${escapeHtml(ctx.organizationName)}</strong> as workspace <strong>${escapeHtml(ctx.role)}</strong>.</p>
                <p>Click the button below to set up your account. This invite is for <strong>${escapeHtml(ctx.recipientEmail)}</strong> and expires on <strong>${escapeHtml(expires)}</strong>.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px 32px;">
                <a href="${ctx.acceptUrl}" style="display:inline-block;padding:12px 22px;background:#fafafa;color:#0b0b0c;text-decoration:none;font-weight:600;font-size:14px;border-radius:8px;">Accept invitation</a>
                <p style="margin:14px 0 0 0;font-size:12px;color:#7a7a82;">Or paste this link into your browser:<br/><span style="color:#9b9ba1;word-break:break-all;">${ctx.acceptUrl}</span></p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px 32px;border-top:1px solid #2a2a2e;font-size:12px;color:#7a7a82;line-height:1.5;">
                <p style="margin:16px 0 0 0;">If you weren't expecting this email, you can safely ignore it. The link won't work unless you confirm with your address.</p>
              </td>
            </tr>
          </table>
          <p style="margin:18px 0 0 0;font-size:11px;color:#5d5d63;">${escapeHtml(SITE.tagline)}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    `${inviter} added you to ${ctx.organizationName} as workspace ${ctx.role}.`,
    "",
    `Accept the invitation:`,
    ctx.acceptUrl,
    "",
    `This invite is for ${ctx.recipientEmail} and expires on ${expires}.`,
    "",
    `If you weren't expecting this email, you can safely ignore it.`,
    `- ${SITE.name}`,
  ].join("\n");

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
