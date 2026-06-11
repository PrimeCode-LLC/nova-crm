"use client";

import * as React from "react";
import { Loader2, Maximize2, Paperclip } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fmtRelative } from "@/lib/format";
import type { MailInbound, MailInboundAttachment, MailSent } from "@/lib/email-account-types";
import { cn } from "@/lib/utils";

export type MailReaderContent = {
  subject?: string;
  from?: string;
  to?: string;
  cc?: string;
  date?: string;
  bodyHtml?: string;
  bodyText?: string;
  preview?: string;
  bodySynced?: boolean;
  attachments?: MailInboundAttachment[];
};

export function mailReaderContentFromInbound(message: MailInbound): MailReaderContent {
  return {
    subject: message.subject,
    from: message.from,
    to: message.to,
    cc: message.cc,
    date: message.date,
    bodyHtml: message.bodyHtml,
    bodyText: message.bodyText,
    preview: message.preview,
    bodySynced: message.bodySynced,
    attachments: message.attachments,
  };
}

export function mailReaderContentFromSent(message: MailSent): MailReaderContent {
  return {
    subject: message.subject,
    from: message.from,
    to: message.to,
    date: message.sentAt,
    bodyHtml: message.bodyHtml,
    bodyText: message.body,
    preview: message.preview,
    bodySynced: message.bodySynced,
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

function MailAttachmentButton({ att }: { att: MailInboundAttachment }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-auto max-w-full gap-1.5 px-2 py-1"
      disabled={!att.contentBase64}
      onClick={() => {
        if (!att.contentBase64) return;
        const blob = Uint8Array.from(atob(att.contentBase64), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([blob], { type: att.mimeType || "application/octet-stream" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = att.filename || "attachment";
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate text-left text-xs font-medium">{att.filename}</span>
      <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">{formatBytes(att.sizeBytes)}</span>
    </Button>
  );
}

export function MailReaderBody({ content, className }: { content: MailReaderContent; className?: string }) {
  const html = content.bodyHtml?.trim();
  const srcDoc = html ? buildInboundHtmlSrcDoc(html) : undefined;
  const { iframeRef, heightPx } = useInboundHtmlIframeHeight(html, srcDoc);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {content.attachments && content.attachments.length > 0 ? (
        <div className="shrink-0 space-y-1.5 rounded-md border border-border/60 bg-muted/10 p-2">
          <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
            <Paperclip className="h-3 w-3 shrink-0" aria-hidden />
            {content.attachments.length} attachment{content.attachments.length === 1 ? "" : "s"}
          </p>
          <div className="flex flex-wrap gap-2">
            {content.attachments.map((att, idx) => (
              <MailAttachmentButton key={`${att.filename}-${idx}`} att={att} />
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
          sandbox=""
          srcDoc={srcDoc}
        />
      ) : content.bodySynced === false && !content.bodyText?.trim() ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading full message…
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
          <DialogDescription asChild>
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
              {content.cc ? (
                <p>
                  <span className="font-medium text-foreground">Cc:</span> {content.cc}
                </p>
              ) : null}
              {content.date ? <p>{fmtRelative(content.date)}</p> : null}
            </div>
          </DialogDescription>
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
