"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { NAV_SECTIONS } from "@/lib/nav";
import { mockLeads, mockAccounts, mockContacts } from "@/lib/mock-data";
import { Plus, Sparkles, Target, Building2, User } from "lucide-react";

export function GlobalCommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search leads, accounts, pages…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        <CommandGroup heading="Quick actions">
          <CommandItem onSelect={() => go("/leads/new")}>
            <Plus className="mr-2 h-4 w-4" /> Add new lead
          </CommandItem>
          <CommandItem onSelect={() => go("/accounts/new")}>
            <Plus className="mr-2 h-4 w-4" /> Add new account
          </CommandItem>
          <CommandItem onSelect={() => go("/activity/new")}>
            <Sparkles className="mr-2 h-4 w-4" /> Log daily activity
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {NAV_SECTIONS.map((section) => (
          <CommandGroup heading={section.label} key={section.label}>
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem key={item.href} onSelect={() => go(item.href)}>
                  <Icon className="mr-2 h-4 w-4" />
                  {item.label}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}

        <CommandSeparator />

        <CommandGroup heading="Leads">
          {mockLeads.slice(0, 6).map((l) => (
            <CommandItem key={l.id} onSelect={() => go(`/leads/${l.id}`)}>
              <Target className="mr-2 h-4 w-4" />
              <span>{l.contactName}</span>
              <span className="ml-auto text-xs text-muted-foreground">{l.companyName}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Accounts">
          {mockAccounts.slice(0, 5).map((a) => (
            <CommandItem key={a.id} onSelect={() => go(`/accounts/${a.id}`)}>
              <Building2 className="mr-2 h-4 w-4" />
              {a.name}
              <span className="ml-auto text-xs text-muted-foreground">{a.industry}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Contacts">
          {mockContacts.slice(0, 5).map((c) => (
            <CommandItem key={c.id} onSelect={() => go(`/contacts/${c.id}`)}>
              <User className="mr-2 h-4 w-4" />
              {c.fullName}
              <span className="ml-auto text-xs text-muted-foreground">{c.title}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
