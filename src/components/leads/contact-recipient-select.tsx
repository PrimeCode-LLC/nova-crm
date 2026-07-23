"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ContactRecipientOption } from "@/lib/email/contact-recipient-options";

export function ContactRecipientSelect({
  id,
  options,
  value,
  onValueChange,
  hint,
}: {
  id: string;
  options: readonly ContactRecipientOption[];
  value: string;
  onValueChange: (email: string) => void;
  /** Optional note under the field (e.g. bounce guidance). */
  hint?: string;
}) {
  if (options.length === 0) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>To</Label>
        <p id={id} className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          No company or personal email on this contact.
        </p>
      </div>
    );
  }

  const selected = options.find((o) => o.email === value) ?? options[0]!;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>To</Label>
      <Select
        value={selected.email}
        onValueChange={(next) => {
          if (next) onValueChange(next);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue>
            <span className="truncate">
              <span className="text-muted-foreground">{selected.label} · </span>
              {selected.email}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={`${opt.kind}:${opt.email}`} value={opt.email}>
              <span className="flex min-w-0 flex-col gap-0.5 text-left">
                <span className="truncate font-medium">{opt.email}</span>
                <span className="text-[11px] text-muted-foreground">{opt.label}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
