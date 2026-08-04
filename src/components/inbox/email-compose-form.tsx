"use client";

import * as React from "react";
import { CalendarClock, Loader2, Paperclip, Send, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_COMPOSE_ATTACHMENTS,
  MAX_COMPOSE_ATTACHMENT_BYTES,
  formatComposeFileSize,
  type ComposeAttachment,
} from "@/lib/email/compose-attachments";

type EmailComposeFormProps = {
  fromField?: React.ReactNode;
  to: string;
  onToChange: (value: string) => void;
  cc: string;
  onCcChange: (value: string) => void;
  bcc?: string;
  onBccChange?: (value: string) => void;
  subject: string;
  onSubjectChange: (value: string) => void;
  body: string;
  onBodyChange: (value: string) => void;
  attachments: ComposeAttachment[];
  onAddAttachments: (files: FileList) => void;
  onRemoveAttachment: (id: string) => void;
  disabled?: boolean;
  sending?: boolean;
  aiBusy?: boolean;
  onImproveWithAi?: () => void;
  onReviewWithAi?: () => void;
  onGenerateAiDraft?: () => void;
  onSaveDraft?: () => void;
  scheduleEnabled?: boolean;
  onScheduleEnabledChange?: (value: boolean) => void;
  scheduledAt?: string;
  onScheduledAtChange?: (value: string) => void;
  minimumScheduledAt?: string;
  /** Shown next to the schedule picker (e.g. workspace timezone). */
  scheduleTimezoneLabel?: string;
  onSend: () => void;
  onScheduleSend?: () => void;
  compact?: boolean;
  handoffHint?: string | null;
};

export function EmailComposeForm({
  fromField,
  to,
  onToChange,
  cc,
  onCcChange,
  bcc = "",
  onBccChange,
  subject,
  onSubjectChange,
  body,
  onBodyChange,
  attachments,
  onAddAttachments,
  onRemoveAttachment,
  disabled = false,
  sending = false,
  aiBusy = false,
  onImproveWithAi,
  onReviewWithAi,
  onGenerateAiDraft,
  onSaveDraft,
  scheduleEnabled = false,
  onScheduleEnabledChange,
  scheduledAt = "",
  onScheduledAtChange,
  minimumScheduledAt,
  scheduleTimezoneLabel,
  onSend,
  onScheduleSend,
  compact = false,
  handoffHint,
}: EmailComposeFormProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const supportsScheduling = Boolean(onScheduleEnabledChange && onScheduledAtChange && onScheduleSend);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={compact ? "space-y-3 py-3" : "min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4"}>
        {fromField ? <div className="space-y-1.5">{fromField}</div> : null}

        <div className={compact ? "grid gap-3 sm:grid-cols-2" : "space-y-3"}>
          <div className="space-y-1.5">
            <Label className="text-xs">To</Label>
            <Input
              value={to}
              onChange={(event) => onToChange(event.target.value)}
              placeholder="name@company.com"
              disabled={disabled}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Cc</Label>
            <Input
              value={cc}
              onChange={(event) => onCcChange(event.target.value)}
              placeholder="Optional, comma-separated addresses"
              disabled={disabled}
            />
          </div>
        </div>

        {onBccChange ? (
          <div className="space-y-1.5">
            <Label className="text-xs">Bcc</Label>
            <Input
              value={bcc}
              onChange={(event) => onBccChange(event.target.value)}
              placeholder="Optional, hidden from recipients"
              disabled={disabled}
            />
          </div>
        ) : null}

        {handoffHint ? (
          <p className="text-[11px] text-muted-foreground">{handoffHint}</p>
        ) : null}

        <div className="space-y-1.5">
          <Label className="text-xs">Subject</Label>
          <Input
            value={subject}
            onChange={(event) => onSubjectChange(event.target.value)}
            disabled={disabled}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">Message</Label>
            <div className="flex items-center gap-1">
              {onReviewWithAi ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                  disabled={!body.trim() || aiBusy || disabled}
                  onClick={onReviewWithAi}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Review with AI
                </Button>
              ) : null}
              {onImproveWithAi ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                  disabled={!body.trim() || aiBusy || disabled}
                  onClick={onImproveWithAi}
                >
                  {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Improvise with AI
                </Button>
              ) : null}
            </div>
          </div>
          <Textarea
            className={compact ? "min-h-[180px] resize-y text-sm" : "min-h-[280px] resize-y text-sm"}
            value={body}
            onChange={(event) => onBodyChange(event.target.value)}
            placeholder="Write your message…"
            disabled={disabled}
          />
        </div>

        <div className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="sr-only"
            onChange={(event) => {
              if (event.target.files?.length) onAddAttachments(event.target.files);
              event.target.value = "";
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={disabled || attachments.length >= MAX_COMPOSE_ATTACHMENTS}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="h-3.5 w-3.5" />
              Attach files
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Up to {MAX_COMPOSE_ATTACHMENTS} files, {formatComposeFileSize(MAX_COMPOSE_ATTACHMENT_BYTES)} each
            </span>
          </div>
          {attachments.length > 0 ? (
            <ul className="space-y-1.5">
              {attachments.map((attachment) => (
                <li
                  key={attachment.id}
                  className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs"
                >
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{attachment.filename}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatComposeFileSize(attachment.sizeBytes)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0"
                    aria-label={`Remove ${attachment.filename}`}
                    onClick={() => onRemoveAttachment(attachment.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {supportsScheduling ? (
          <div className="space-y-3 rounded-lg border bg-muted/20 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor="compose-schedule-toggle" className="text-xs font-medium">
                  Schedule send
                </Label>
                <p className="text-[11px] text-muted-foreground">Send later at a specific date and time.</p>
              </div>
              <Switch
                id="compose-schedule-toggle"
                checked={scheduleEnabled}
                disabled={disabled}
                onCheckedChange={onScheduleEnabledChange}
              />
            </div>
            {scheduleEnabled ? (
              <div className="space-y-1.5">
                <Label htmlFor="compose-scheduled-at" className="text-xs">
                  Send on{scheduleTimezoneLabel ? ` · ${scheduleTimezoneLabel}` : ""}
                </Label>
                <Input
                  id="compose-scheduled-at"
                  type="datetime-local"
                  value={scheduledAt}
                  min={minimumScheduledAt}
                  disabled={disabled}
                  onChange={(event) => onScheduledAtChange?.(event.target.value)}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className={compact ? "flex flex-wrap items-center justify-end gap-2 border-t pt-3" : "shrink-0 border-t bg-muted/30 px-5 pb-5 pt-4"}>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {onGenerateAiDraft ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={aiBusy || disabled}
              onClick={onGenerateAiDraft}
            >
              {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              AI draft
            </Button>
          ) : null}
          {onSaveDraft ? (
            <Button variant="outline" size="sm" disabled={disabled} onClick={onSaveDraft}>
              Save draft
            </Button>
          ) : null}
          {scheduleEnabled && onScheduleSend ? (
            <Button size="sm" className="gap-1.5" disabled={sending || disabled} onClick={onScheduleSend}>
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
              Schedule send
            </Button>
          ) : (
            <Button size="sm" className="gap-1.5" disabled={sending || disabled} onClick={onSend}>
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
