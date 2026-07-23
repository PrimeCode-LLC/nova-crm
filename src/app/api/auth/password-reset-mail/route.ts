import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";
import {
  sendSystemEmail,
  systemEmailConfigHint,
} from "@/lib/email/send-system-email";
import { publicSiteOriginFromRequest, resetPasswordPageUrl } from "@/lib/auth/site-origin";

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Generates a Firebase password reset link (Admin SDK) and emails it via
 * SYSTEM_SMTP_* - not Firebase's built-in mailer.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { email?: string };
    const email = normalizeEmail(String(body.email ?? ""));
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
    }

    const adminAuth = getAdminAuth();
    if (!adminAuth) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Server is not configured for password reset email (Firebase Admin credentials missing).",
        },
        { status: 503 },
      );
    }

    /* Continue URL must be same-origin /reset-password so oobCode matches our custom page. */
    const continueUrl = resetPasswordPageUrl(req);

    let link: string;
    try {
      link = await adminAuth.generatePasswordResetLink(email, {
        url: continueUrl,
        handleCodeInApp: false,
      });
    } catch {
      /* Avoid leaking whether the account exists (same as typical forgot-password UX). */
      return NextResponse.json({
        ok: true,
        message: "If an account exists for that email, a reset link was sent.",
      });
    }

    let linkForEmail = link;
    try {
      const u = new URL(link);
      const oobCode = u.searchParams.get("oobCode");
      if (oobCode) {
        const origin = publicSiteOriginFromRequest(req);
        linkForEmail = `${origin}/reset-password?oobCode=${encodeURIComponent(oobCode)}`;
      }
    } catch {
      /* keep Firebase-hosted link */
    }

    const siteLabel = process.env.NEXT_PUBLIC_SITE_NAME?.trim() || "Nova CRM";
    const result = await sendSystemEmail({
      to: email,
      subject: `Reset your ${siteLabel} password`,
      text: `You asked to reset your ${siteLabel} password.\n\nOpen this link on this site to choose a new password (it expires soon):\n${linkForEmail}\n\nIf you didn't request this, you can ignore this email.`,
      html: `<p>You asked to reset your <strong>${escapeHtml(siteLabel)}</strong> password.</p><p><a href="${escapeAttr(linkForEmail)}">Reset password</a></p><p style="color:#666;font-size:12px">If you didn't request this, you can ignore this email.</p>`,
    });

    if (!result.ok) {
      if (result.reason === "not_configured") {
        return NextResponse.json(
          {
            ok: false,
            error: `Outgoing mail is not configured. ${systemEmailConfigHint()}`,
          },
          { status: 503 },
        );
      }
      return NextResponse.json(
        { ok: false, error: result.error ?? "Could not send email." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, message: "Check your email for a reset link." });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
