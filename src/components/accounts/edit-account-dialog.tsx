"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { COMPANY_SIZES, COMPANY_SIZE_LABELS, REVENUE_RANGES } from "@/lib/constants";
import type { Account, CompanySize, RevenueRange } from "@/lib/types";

const UNSET = "__unset__" as const;

function parseTechStack(raw: string): string[] | undefined {
  const values = raw
    .split(/[,;\n]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const unique = [...new Set(values)];
  return unique.length ? unique : undefined;
}

export function EditAccountDialog({
  open,
  onOpenChange,
  account,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: Account;
  onSave: (patch: Partial<Account>) => void;
}) {
  const [name, setName] = React.useState("");
  const [domain, setDomain] = React.useState("");
  const [industry, setIndustry] = React.useState("");
  const [size, setSize] = React.useState<CompanySize | typeof UNSET>(UNSET);
  const [revenueRange, setRevenueRange] = React.useState<RevenueRange | typeof UNSET>(UNSET);
  const [yearFounded, setYearFounded] = React.useState("");
  const [city, setCity] = React.useState("");
  const [state, setState] = React.useState("");
  const [country, setCountry] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [linkedin, setLinkedin] = React.useState("");
  const [techStack, setTechStack] = React.useState("");

  // Seed once when the dialog opens (or account id changes). Do not depend on the
  // full `account` object — live CRM polls recreate it and were wiping in-progress
  // edits (size, revenue, year founded, tech stack). useLayoutEffect avoids a
  // startTransition race where typed/selected values were flushed away right after open.
  React.useLayoutEffect(() => {
    if (!open) return;
    setName(account.name ?? "");
    setDomain(account.domain ?? "");
    setIndustry(account.industry ?? "");
    setSize(account.size ?? UNSET);
    setRevenueRange(account.revenueRange ?? UNSET);
    setYearFounded(account.yearFounded != null ? String(account.yearFounded) : "");
    setCity(account.city ?? (!account.state && !account.country ? account.location ?? "" : ""));
    setState(account.state ?? "");
    setCountry(account.country ?? "");
    setDescription(account.businessDescription ?? "");
    setWebsite(account.website ?? "");
    setLinkedin(account.linkedin ?? "");
    setTechStack(account.techStack?.join(", ") ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: open + account.id only
  }, [open, account.id]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Company name is required.");
      return;
    }

    const year = yearFounded.trim();
    let parsedYear: number | undefined;
    if (year) {
      const value = Number(year);
      if (!Number.isInteger(value) || value < 1800 || value > new Date().getFullYear() + 1) {
        toast.error("Year founded should be a valid year.");
        return;
      }
      parsedYear = value;
    }

    const locationParts = [city.trim(), state.trim(), country.trim()].filter(Boolean);
    onSave({
      name: trimmedName,
      domain: domain.trim() || undefined,
      industry: industry.trim() || undefined,
      size: size === UNSET ? undefined : size,
      revenueRange: revenueRange === UNSET ? undefined : revenueRange,
      yearFounded: parsedYear,
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      country: country.trim() || undefined,
      location: locationParts.length ? locationParts.join(", ") : undefined,
      businessDescription: description.trim() || undefined,
      website: website.trim() || undefined,
      linkedin: linkedin.trim() || undefined,
      techStack: parseTechStack(techStack),
    });
    toast.success("Company updated");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90vh,760px)] overflow-y-auto sm:max-w-2xl" showCloseButton>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit company</DialogTitle>
            <DialogDescription>Update the company information shared by its contacts and leads.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-3 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="account-edit-name">Company name</Label>
              <Input id="account-edit-name" value={name} onChange={(event) => setName(event.target.value)} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="account-edit-domain">Domain</Label>
              <Input
                id="account-edit-domain"
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
                placeholder="example.com"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="account-edit-industry">Industry</Label>
              <Input
                id="account-edit-industry"
                value={industry}
                onChange={(event) => setIndustry(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Company size</Label>
              <Select value={size} onValueChange={(value) => value && setSize(value as CompanySize | typeof UNSET)}>
                <SelectTrigger>
                  <SelectValue placeholder="Not set">
                    {size === UNSET ? undefined : COMPANY_SIZE_LABELS[size]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNSET}>Not set</SelectItem>
                  {COMPANY_SIZES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {COMPANY_SIZE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Revenue range</Label>
              <Select
                value={revenueRange}
                onValueChange={(value) => value && setRevenueRange(value as RevenueRange | typeof UNSET)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not set">
                    {revenueRange === UNSET ? undefined : REVENUE_RANGES[revenueRange]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNSET}>Not set</SelectItem>
                  {(Object.keys(REVENUE_RANGES) as RevenueRange[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {REVENUE_RANGES[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="account-edit-founded">Year founded</Label>
              <Input
                id="account-edit-founded"
                inputMode="numeric"
                value={yearFounded}
                onChange={(event) => setYearFounded(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="account-edit-city">City</Label>
              <Input id="account-edit-city" value={city} onChange={(event) => setCity(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="account-edit-state">State / region</Label>
              <Input id="account-edit-state" value={state} onChange={(event) => setState(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="account-edit-country">Country</Label>
              <Input id="account-edit-country" value={country} onChange={(event) => setCountry(event.target.value)} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="account-edit-description">Summary</Label>
              <Textarea
                id="account-edit-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                className="resize-none"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="account-edit-website">Website URL</Label>
              <Input
                id="account-edit-website"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                placeholder="https://example.com"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="account-edit-linkedin">LinkedIn URL</Label>
              <Input
                id="account-edit-linkedin"
                value={linkedin}
                onChange={(event) => setLinkedin(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="account-edit-tech">Tech stack</Label>
              <Input
                id="account-edit-tech"
                value={techStack}
                onChange={(event) => setTechStack(event.target.value)}
                placeholder="Comma-separated"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
