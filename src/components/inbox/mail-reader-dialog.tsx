"use client";

import * as React from "react";
import { Download, Eye, Loader2, Maximize2, Paperclip } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fmtRelative } from "@/lib/format";
import type { MailInbound, MailInboundAttachment, MailSent } from "@/lib/email-account-types";
import { isSubjectOnlyMailBody } from "@/lib/email/mail-body-stub";
import { cn } from "@/lib/utils";
import { CalendarInviteBannerFromAttachments } from "@/components/inbox/calendar-invite-banner";

export type MailAttachmentResolver = (
  att: MailInboundAttachment,
  index: number,
  mode: "view" | "download",
) => Promise<{ blob: Blob; mimeType: string; filename: string } | null>;

export type MailReaderContent = {
  subject?: string;
  from?: string;
  replyTo?: string;
  to?: string;
  cc?: string;
  date?: string;
  bodyHtml?: string;
  bodyText?: string;
  preview?: string;
  bodySynced?: boolean;
  attachments?: MailInboundAttachment[];
  mailboxId?: string;
  uid?: number;
  folder?: "inbox" | "sent";
};

export function mailReaderContentFromInbound(
  message: MailInbound,
  extras?: { mailboxId?: string },
): MailReaderContent {
  return {
    subject: message.subject,
    from: message.from,
    replyTo: message.replyTo,
    to: message.to,
    cc: message.cc,
    date: message.date,
    bodyHtml: message.bodyHtml,
    bodyText: message.bodyText,
    preview: message.preview,
    bodySynced: message.bodySynced,
    attachments: message.attachments,
    mailboxId: extras?.mailboxId,
    uid: message.uid || undefined,
    folder: extras?.mailboxId ? "inbox" : undefined,
  };
}

export function mailReaderContentFromSent(message: MailSent): MailReaderContent {
  return {
    subject: message.subject,
    from: message.from,
    replyTo: message.replyTo,
    to: message.to,
    cc: message.cc,
    date: message.sentAt,
    bodyHtml: message.bodyHtml,
    bodyText: message.body,
    preview: message.preview,
    bodySynced: message.bodySynced,
    attachments: message.attachments,
    mailboxId: message.mailboxId,
    uid: message.uid,
    folder: "sent",
  };
}

function buildInboundHtmlSrcDoc(html: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank" rel="noopener noreferrer"><style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 15px; line-height: 1.6; color: #fafafa; background: #09090b; margin: 16px; overflow-wrap: anywhere; }
      img { max-width: 100%; height: auto; }
      a { color: #93c5fd; }
      blockquote { border-left: 2px solid #3f3f46; margin: 0.5em 0; padding-left: 0.75em; color: #a1a1aa; }
    </style></head><body>${html}</body></html>`;
}

function useInboundHtmlIframeHeight(html: string | undefined, srcDoc: string | undefined) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [heightPx, setHeightPx] = React.useState(480);

  React.useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !srcDoc) return;

    const measure = () => {
      try {
        const doc = iframe.contentDocument;
        const h = doc?.documentElement?.scrollHeight ?? doc?.body?.scrollHeight;
        if (h && h > 0) {
          setHeightPx(Math.min(Math.max(h + 32, 400), 4000));
        }
      } catch {
        /* sandbox */
      }
    };

    iframe.addEventListener("load", measure);
    const t = window.setTimeout(measure, 120);
    return () => {
      iframe.removeEventListener("load", measure);
      window.clearTimeout(t);
    };
  }, [html, srcDoc]);

  return { iframeRef, heightPx };
}

function senderDisplayLabel(from: string | undefined): string {
  if (!from?.trim()) return "Unknown sender";
  const angle = from.match(/^([^<]+)</);
  if (angle) return angle[1]!.trim().replace(/^["']|["']$/g, "");
  return from.trim();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function blobFromBase64(contentBase64: string, mimeType: string): Blob {
  const bin = atob(contentBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || "application/octet-stream" });
}

function openOrDownloadAttachment(input: {
  blob: Blob;
  filename: string;
  mode: "view" | "download";
}) {
  const url = URL.createObjectURL(input.blob);
  if (input.mode === "view") {
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = input.filename || "attachment";
  a.click();
  URL.revokeObjectURL(url);
}

function MailAttachmentButton({
  att,
  index,
  resolveAttachment,
}: {
  att: MailInboundAttachment;
  index: number;
  resolveAttachment?: MailAttachmentResolver;
}) {
  const [busy, setBusy] = React.useState<"view" | "download" | null>(null);
  const canUseInline = Boolean(att.contentBase64);
  const canFetch = Boolean(resolveAttachment);
  const disabled = !canUseInline && !canFetch;

  async function run(mode: "view" | "download") {
    if (att.contentBase64) {
      openOrDownloadAttachment({
        blob: blobFromBase64(att.contentBase64, att.mimeType),
        filename: att.filename,
        mode,
      });
      return;
    }
    if (!resolveAttachment) {
      toast.message("Attachment is not available in this view", {
        description: "Open the same message in your mailbox app to download the file.",
      });
      return;
    }
    setBusy(mode);
    try {
      const resolved = await resolveAttachment(att, index, mode);
      if (!resolved?.blob) {
        toast.error("Could not load this attachment from the mailbox.");
        return;
      }
      openOrDownloadAttachment({ blob: resolved.blob, filename: resolved.filename, mode });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load attachment");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex max-w-full items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2 py-1">
      <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">{att.filename}</p>
        <p className="text-[10px] text-muted-foreground tabular-nums">{formatBytes(att.sizeBytes)}</p>
      </div>
      <div className="ml-1 flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={disabled || busy !== null}
          onClick={() => void run("view")}
          aria-label={`View ${att.filename}`}
          title="View"
        >
          {busy === "view" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={disabled || busy !== null}
          onClick={() => void run("download")}
          aria-label={`Download ${att.filename}`}
          title="Download"
        >
          {busy === "download" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

export function MailReaderBody({
  content,
  className,
  bodyLoading,
  onRetryBody,
  resolveAttachment,
}: {
  content: MailReaderContent;
  className?: string;
  /** True while a body fetch is in flight for this message. */
  bodyLoading?: boolean;
  /** Shown when bodySynced is false and loading finished — retry fetch. */
  onRetryBody?: () => void;
  resolveAttachment?: MailAttachmentResolver;
}) {
  const html = content.bodyHtml?.trim();
  const srcDoc = html ? buildInboundHtmlSrcDoc(html) : undefined;
  const { iframeRef, heightPx } = useInboundHtmlIframeHeight(html, srcDoc);
  const stubBody = isSubjectOnlyMailBody({
    subject: content.subject,
    bodyText: content.bodyText,
    bodyHtml: content.bodyHtml,
  });
  const needsBody = (content.bodySynced === false || stubBody) && !html;
  const showBodySpinner = needsBody && bodyLoading === true;
  const showBodyFailed = needsBody && bodyLoading === false;
  // No loading controller (e.g. inbox reader): prefer preview over an infinite spinner.
  const showHeadsOnlyPreview =
    needsBody && bodyLoading === undefined && Boolean(content.preview?.trim());

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <CalendarInviteBannerFromAttachments
        attachments={content.attachments}
        from={content.from}
        subject={content.subject}
        bodyText={content.bodyText}
      />
      {content.attachments && content.attachments.length > 0 ? (
        <div className="shrink-0 space-y-1.5 rounded-md border border-border/60 bg-muted/10 p-2">
          <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
            <Paperclip className="h-3 w-3 shrink-0" aria-hidden />
            {content.attachments.length} attachment{content.attachments.length === 1 ? "" : "s"}
          </p>
          <div className="flex flex-wrap gap-2">
            {content.attachments.map((att, idx) => (
              <MailAttachmentButton
                key={`${att.filename}-${idx}`}
                att={att}
                index={idx}
                resolveAttachment={resolveAttachment}
              />
            ))}
          </div>
        </div>
      ) : null}
      {html && srcDoc ? (
        <iframe
          ref={iframeRef}
          title={`HTML: ${content.subject || "message"}`}
          className="w-full shrink-0 rounded-md border bg-background"
          style={{ height: heightPx }}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          srcDoc={srcDoc}
        />
      ) : showBodySpinner || (needsBody && bodyLoading === undefined && !content.preview?.trim()) ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading full message…
        </div>
      ) : showBodyFailed || showHeadsOnlyPreview ? (
        <div className="space-y-3 rounded-md border border-dashed bg-muted/5 p-4">
          {content.preview?.trim() ? (
            <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-muted-foreground">
              {content.preview}
            </div>
          ) : null}
          {showBodyFailed ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>Couldn’t load full message.</span>
              {onRetryBody ? (
                <Button type="button" variant="outline" size="sm" className="h-7" onClick={onRetryBody}>
                  Retry
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="whitespace-pre-wrap overflow-x-auto rounded-md border bg-muted/5 p-4 text-[15px] leading-relaxed">
          {content.bodyText || content.preview || ""}
        </div>
      )}
    </div>
  );
}

export function MailReaderDialog({
  open,
  onOpenChange,
  content,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  content: MailReaderContent | null;
}) {
  if (!content) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex max-h-[min(92vh,920px)] w-[min(98vw,1280px)] max-w-[min(98vw,1280px)] sm:max-w-[min(98vw,1280px)] flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="shrink-0 space-y-2 border-b px-5 py-4 pr-12 text-left">
          <DialogTitle className="text-base leading-snug">
            {content.subject?.trim() || "(no subject)"}
          </DialogTitle>
          <div className="space-y-0.5 text-xs text-muted-foreground">
            {content.from ? (
              <p>
                <span className="font-medium text-foreground">From:</span> {senderDisplayLabel(content.from)}{" "}
                <span className="break-all">({content.from})</span>
              </p>
            ) : null}
            {content.to ? (
              <p>
                <span className="font-medium text-foreground">To:</span> {content.to}
              </p>
            ) : null}
            {content.replyTo && content.replyTo !== content.from ? (
              <p>
                <span className="font-medium text-foreground">Reply-To:</span> {content.replyTo}
              </p>
            ) : null}
            {content.cc ? (
              <p>
                <span className="font-medium text-foreground">Cc:</span> {content.cc}
              </p>
            ) : null}
            {content.date ? <p>{fmtRelative(content.date)}</p> : null}
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <MailReaderBody content={content} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MailReadingZoomActions({ content }: { content: MailReaderContent }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <MailZoomButton onClick={() => setOpen(true)} />
      <MailReaderDialog open={open} onOpenChange={setOpen} content={content} />
    </>
  );
}

export function MailZoomButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground", className)}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label="Expand message"
      title="Expand message"
    >
      <Maximize2 className="h-3.5 w-3.5" />
    </Button>
  );
}
