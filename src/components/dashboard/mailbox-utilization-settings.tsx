"use client";

import { Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  isMailboxUtilizationVisible,
  mailboxUtilizationPrefsKey,
  type MailboxUtilizationVisibility,
} from "@/lib/dashboard-preferences";

export type MailboxUtilizationSettingsOption = {
  ownerUid: string;
  mailboxId: string;
  label: string;
  emailAddress: string;
};

export function MailboxUtilizationSettings({
  mailboxes,
  visible,
  onChange,
  onShowAll,
  onHideAll,
}: {
  mailboxes: MailboxUtilizationSettingsOption[];
  visible: MailboxUtilizationVisibility | null | undefined;
  onChange: (ownerUid: string, mailboxId: string, enabled: boolean) => void;
  onShowAll: () => void;
  onHideAll: () => void;
}) {
  const hiddenCount = mailboxes.filter(
    (m) => !isMailboxUtilizationVisible(visible, m.ownerUid, m.mailboxId),
  ).length;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="relative text-muted-foreground"
            aria-label="Inbox utilization settings"
          >
            <Settings2 className="h-3.5 w-3.5" />
            {hiddenCount > 0 ? (
              <Badge
                variant="secondary"
                className="absolute -top-1 -right-1 h-4 min-w-4 justify-center px-1 text-[10px] font-normal"
              >
                {hiddenCount}
              </Badge>
            ) : null}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80 gap-3 p-3">
        <PopoverHeader>
          <PopoverTitle>Visible inboxes</PopoverTitle>
          <PopoverDescription>
            Hide mailboxes you do not want on this card or the full list. Saved on this browser.
          </PopoverDescription>
        </PopoverHeader>

        <div className="flex justify-end gap-1">
          <Button type="button" variant="ghost" size="xs" onClick={onShowAll}>
            All on
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={onHideAll}>
            All off
          </Button>
        </div>

        {mailboxes.length === 0 ? (
          <p className="py-2 text-center text-xs text-muted-foreground">No mailboxes yet.</p>
        ) : (
          <ul className="max-h-72 space-y-2.5 overflow-y-auto pr-0.5">
            {mailboxes.map((mailbox) => {
              const on = isMailboxUtilizationVisible(
                visible,
                mailbox.ownerUid,
                mailbox.mailboxId,
              );
              const id = `mailbox-util-${mailboxUtilizationPrefsKey(mailbox.ownerUid, mailbox.mailboxId)}`;
              return (
                <li
                  key={mailboxUtilizationPrefsKey(mailbox.ownerUid, mailbox.mailboxId)}
                  className="flex items-center justify-between gap-3"
                >
                  <Label
                    htmlFor={id}
                    className="min-w-0 cursor-pointer text-sm font-normal leading-snug"
                  >
                    <span className="block truncate">{mailbox.label}</span>
                    {mailbox.emailAddress ? (
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {mailbox.emailAddress}
                      </span>
                    ) : null}
                  </Label>
                  <Switch
                    id={id}
                    size="sm"
                    checked={on}
                    onCheckedChange={(checked) =>
                      onChange(mailbox.ownerUid, mailbox.mailboxId, Boolean(checked))
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
