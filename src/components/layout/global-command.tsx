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
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useOpenQuickAdd } from "@/components/layout/quick-add-launcher";
import { Plus, Sparkles, Target, Building2, User, IdCard } from "lucide-react";

export function GlobalCommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { leads, accounts, contacts, users, profiles } = useWorkspace();
  const { openQuickAdd } = useOpenQuickAdd();
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
          <CommandItem
            onSelect={() => {
              onOpenChange(false);
              openQuickAdd({ initialPill: "lead" });
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Add new lead
          </CommandItem>
          <CommandItem
            onSelect={() => {
              onOpenChange(false);
              openQuickAdd({ initialPill: "contact" });
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Add new contact
          </CommandItem>
          <CommandItem
            onSelect={() => {
              onOpenChange(false);
              openQuickAdd({ initialPill: "account" });
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Add new account
          </CommandItem>
          <CommandItem
            onSelect={() => {
              onOpenChange(false);
              openQuickAdd({ initialPill: "profile" });
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Add outreach profile
          </CommandItem>
          <CommandItem onSelect={() => go("/activity")}>
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

        <CommandGroup heading="Team">
          {users.slice(0, 12).map((u) => (
            <CommandItem
              key={u.id}
              onSelect={() => go(`/admin/users?user=${encodeURIComponent(u.id)}`)}
            >
              <User className="mr-2 h-4 w-4" />
              <span>{u.displayName}</span>
              <span className="ml-auto max-w-[140px] truncate text-xs text-muted-foreground">
                {u.title ?? u.email}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Leads">
          {leads.slice(0, 6).map((l) => (
            <CommandItem key={l.id} onSelect={() => go(`/leads/${l.id}`)}>
              <Target className="mr-2 h-4 w-4" />
              <span>{l.contactName}</span>
              <span className="ml-auto text-xs text-muted-foreground">{l.companyName}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Accounts">
          {accounts.slice(0, 5).map((a) => (
            <CommandItem key={a.id} onSelect={() => go(`/accounts/${a.id}`)}>
              <Building2 className="mr-2 h-4 w-4" />
              {a.name}
              <span className="ml-auto text-xs text-muted-foreground">{a.industry}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Contacts">
          {contacts.slice(0, 5).map((c) => (
            <CommandItem key={c.id} onSelect={() => go(`/contacts/${c.id}`)}>
              <User className="mr-2 h-4 w-4" />
              {c.fullName}
              <span className="ml-auto text-xs text-muted-foreground">{c.title}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        {profiles.length > 0 && (
          <CommandGroup heading="Profiles">
            {profiles.slice(0, 12).map((p) => (
              <CommandItem key={p.id} onSelect={() => go("/admin/profiles")}>
                <IdCard className="mr-2 h-4 w-4" />
                <span className="truncate">{p.name}</span>
                <span className="ml-auto text-xs capitalize text-muted-foreground">{p.type}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
