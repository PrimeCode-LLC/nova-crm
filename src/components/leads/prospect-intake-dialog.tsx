"use client";

import * as React from "react";
import { toast } from "sonner";
import type {
  Account,
  Contact,
  Lead,
  CompanySize,
  RevenueRange,
  BusinessStatus,
  WebsiteStatus,
  OnlineActivityScore,
  EmailVerificationStatus,
  BestContactChannel,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { REVENUE_RANGES, COMPANY_SIZES, COMPANY_SIZE_LABELS } from "@/lib/constants";
import { leadSnapshotPatchFromAccountContact } from "@/lib/lead-graph-snapshots";

const UNSET = "__unset__" as const;

function isoFromDateInput(dateStr: string): string | undefined {
  if (!dateStr.trim()) return undefined;
  const d = new Date(`${dateStr}T12:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function dateInputFromIso(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseTechStack(raw: string): string[] | undefined {
  const parts = raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const uniq = [...new Set(parts)];
  return uniq.length ? uniq : undefined;
}

function techStackToString(tools?: string[]): string {
  return tools?.length ? tools.join(", ") : "";
}

const BUSINESS_STATUS_OPTS: { value: BusinessStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "new", label: "New" },
  { value: "dormant", label: "Dormant" },
];

const WEBSITE_STATUS_OPTS: { value: WebsiteStatus; label: string }[] = [
  { value: "live", label: "Live" },
  { value: "under_construction", label: "Under construction" },
  { value: "none", label: "No website" },
];

const ACTIVITY_OPTS: { value: OnlineActivityScore; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const EMAIL_VERIFY_OPTS: { value: EmailVerificationStatus; label: string }[] = [
  { value: "not_verified", label: "Not verified" },
  { value: "verified", label: "Verified" },
  { value: "bounced", label: "Bounced" },
  { value: "catch_all", label: "Catch-all" },
];

const BEST_CHANNEL_OPTS: { value: BestContactChannel; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "form", label: "Form" },
];

export function ProspectIntakeDialog({
  open,
  onOpenChange,
  account,
  contact,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: Account | undefined;
  contact: Contact | undefined;
  onSave: (args: {
    accountPatch: Partial<Account>;
    contactPatch: Partial<Contact>;
    leadPatch: Partial<Lead>;
  }) => void;
}) {
  const [bizName, setBizName] = React.useState("");
  const [industry, setIndustry] = React.useState("");
  const [bizDesc, setBizDesc] = React.useState("");
  const [city, setCity] = React.useState("");
  const [state, setState] = React.useState("");
  const [country, setCountry] = React.useState("");
  const [yearFounded, setYearFounded] = React.useState("");
  const [bizStatus, setBizStatus] = React.useState<BusinessStatus | typeof UNSET>(UNSET);
  const [size, setSize] = React.useState<CompanySize | typeof UNSET>(UNSET);
  const [rev, setRev] = React.useState<RevenueRange | typeof UNSET>(UNSET);
  const [website, setWebsite] = React.useState("");
  const [companyLinkedin, setCompanyLinkedin] = React.useState("");
  const [webStatus, setWebStatus] = React.useState<WebsiteStatus | typeof UNSET>(UNSET);
  const [techStackStr, setTechStackStr] = React.useState("");
  const [activity, setActivity] = React.useState<OnlineActivityScore | typeof UNSET>(UNSET);
  const [lastSiteAt, setLastSiteAt] = React.useState("");
  const [lastSiteNote, setLastSiteNote] = React.useState("");
  const [careersUrl, setCareersUrl] = React.useState("");

  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [seniority, setSeniority] = React.useState("");
  const [contactLocation, setContactLocation] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [personalEmail, setPersonalEmail] = React.useState("");
  const [emailVerify, setEmailVerify] = React.useState<EmailVerificationStatus | typeof UNSET>(UNSET);
  const [phone, setPhone] = React.useState("");
  const [contactSource, setContactSource] = React.useState("");
  const [bestChannel, setBestChannel] = React.useState<BestContactChannel | typeof UNSET>(UNSET);
  const [linkedin, setLinkedin] = React.useState("");

  React.useEffect(() => {
    if (!open || !account || !contact) return;
    React.startTransition(() => {
      setBizName(account.name ?? "");
      setIndustry(account.industry ?? "");
      setBizDesc(account.businessDescription ?? "");
      setCity(account.city ?? "");
      setState(account.state ?? "");
      setCountry(account.country ?? "");
      setYearFounded(account.yearFounded != null ? String(account.yearFounded) : "");
      setBizStatus(account.businessStatus ?? UNSET);
      setSize(account.size ?? UNSET);
      setRev(account.revenueRange ?? UNSET);
      setWebsite(account.website ?? "");
      setCompanyLinkedin(account.linkedin ?? "");
      setWebStatus(account.websiteStatus ?? UNSET);
      setTechStackStr(techStackToString(account.techStack));
      setActivity(account.onlineActivityScore ?? UNSET);
      setLastSiteAt(dateInputFromIso(account.lastWebsiteActivityAt));
      setLastSiteNote(account.lastWebsiteActivityNote ?? "");
      setCareersUrl(account.careersPageUrl ?? "");

      setFirstName(contact.firstName ?? "");
      setLastName(contact.lastName ?? "");
      setTitle(contact.title ?? "");
      setSeniority(contact.seniority ?? "");
      setContactLocation(contact.location ?? "");
      setEmail(contact.email ?? "");
      setPersonalEmail(contact.personalEmail ?? "");
      setEmailVerify(contact.emailVerificationStatus ?? UNSET);
      setPhone(contact.phone ?? "");
      setContactSource(contact.contactSource ?? "");
      setBestChannel(contact.bestContactChannel ?? UNSET);
      setLinkedin(contact.linkedin ?? "");
    });
  }, [open, account, contact]);

  if (!account || !contact) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!account || !contact) return;
    const yf = yearFounded.trim();
    let yearFoundedNum: number | undefined;
    if (yf) {
      const n = Number(yf);
      if (!Number.isFinite(n) || n < 1800 || n > new Date().getFullYear() + 1) {
        toast.error("Year founded should be a valid year.");
        return;
      }
      yearFoundedNum = Math.round(n);
    }

    const locParts = [city.trim(), state.trim(), country.trim()].filter(Boolean);
    const locationStr = locParts.length ? locParts.join(", ") : undefined;

    const accountPatch: Partial<Account> = {
      name: bizName.trim() || account.name,
      industry: industry.trim() || undefined,
      businessDescription: bizDesc.trim() || undefined,
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      country: country.trim() || undefined,
      location: locationStr,
      yearFounded: yearFoundedNum,
      businessStatus: bizStatus === UNSET ? undefined : bizStatus,
      size: size === UNSET ? undefined : size,
      revenueRange: rev === UNSET ? undefined : rev,
      website: website.trim() || undefined,
      linkedin: companyLinkedin.trim() || undefined,
      websiteStatus: webStatus === UNSET ? undefined : webStatus,
      techStack: parseTechStack(techStackStr),
      onlineActivityScore: activity === UNSET ? undefined : activity,
      lastWebsiteActivityAt: isoFromDateInput(lastSiteAt),
      lastWebsiteActivityNote: lastSiteNote.trim() || undefined,
      careersPageUrl: careersUrl.trim() || undefined,
    };

    const fn = firstName.trim() || contact.firstName;
    const ln = lastName.trim() || contact.lastName;
    const fullName = fn && ln && fn !== ln ? `${fn} ${ln}`.trim() : fn || ln;

    const contactPatch: Partial<Contact> = {
      firstName: fn,
      lastName: ln,
      fullName,
      title: title.trim() || undefined,
      seniority: seniority.trim() || undefined,
      location: contactLocation.trim() || undefined,
      email: email.trim() || undefined,
      personalEmail: personalEmail.trim() || undefined,
      emailVerificationStatus: emailVerify === UNSET ? undefined : emailVerify,
      phone: phone.trim() || undefined,
      contactSource: contactSource.trim() || undefined,
      bestContactChannel: bestChannel === UNSET ? undefined : bestChannel,
      linkedin: linkedin.trim() || undefined,
    };

    const leadPatch = leadSnapshotPatchFromAccountContact(accountPatch, contactPatch);

    onSave({ accountPatch, contactPatch, leadPatch });
    toast.success("Prospect fields saved");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[min(90vh,800px)] overflow-y-auto" showCloseButton>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Prospect & company data</DialogTitle>
            <DialogDescription>
              Research fields for intake and routing (integrations, campaigns, outbound). Lead-by and assignment stay
              on the lead header.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 py-3">
            <section className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Business</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Business Name</Label>
                  <Input
                    value={bizName}
                    onChange={(e) => setBizName(e.target.value)}
                    required
                    placeholder="Stellixsoft, Acme Inc."
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Industry</Label>
                  <Input
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    placeholder="Real estate, Software house…"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Year founded</Label>
                  <Input value={yearFounded} onChange={(e) => setYearFounded(e.target.value)} placeholder="2018" />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Business description (one line)</Label>
                  <Input
                    value={bizDesc}
                    onChange={(e) => setBizDesc(e.target.value)}
                    placeholder="What they do in one sentence"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>City</Label>
                  <Input value={city} onChange={(e) => setCity(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label>State / region</Label>
                  <Input value={state} onChange={(e) => setState(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Country</Label>
                  <Input value={country} onChange={(e) => setCountry(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Business status</Label>
                  <Select
                    value={bizStatus}
                    onValueChange={(v) => v && setBizStatus(v as BusinessStatus | typeof UNSET)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Not set</SelectItem>
                      {BUSINESS_STATUS_OPTS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Company size</Label>
                  <Select value={size} onValueChange={(v) => v && setSize(v as CompanySize | typeof UNSET)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Not set</SelectItem>
                      {COMPANY_SIZES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {COMPANY_SIZE_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Revenue range (est.)</Label>
                  <Select value={rev} onValueChange={(v) => v && setRev(v as RevenueRange | typeof UNSET)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Not set</SelectItem>
                      {(Object.keys(REVENUE_RANGES) as RevenueRange[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {REVENUE_RANGES[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Website URL</Label>
                  <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Company LinkedIn URL</Label>
                  <Input
                    value={companyLinkedin}
                    onChange={(e) => setCompanyLinkedin(e.target.value)}
                    placeholder="https://linkedin.com/company/…"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Website status</Label>
                  <Select
                    value={webStatus}
                    onValueChange={(v) => v && setWebStatus(v as WebsiteStatus | typeof UNSET)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Not set</SelectItem>
                      {WEBSITE_STATUS_OPTS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Online activity score</Label>
                  <Select
                    value={activity}
                    onValueChange={(v) => v && setActivity(v as OnlineActivityScore | typeof UNSET)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Not set</SelectItem>
                      {ACTIVITY_OPTS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Last website update (date)</Label>
                  <Input type="date" value={lastSiteAt} onChange={(e) => setLastSiteAt(e.target.value)} />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Last website activity (notes)</Label>
                  <Textarea
                    value={lastSiteNote}
                    onChange={(e) => setLastSiteNote(e.target.value)}
                    rows={2}
                    className="resize-none"
                    placeholder="Observations if no exact date"
                  />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Tech stack / platform</Label>
                  <Input
                    value={techStackStr}
                    onChange={(e) => setTechStackStr(e.target.value)}
                    placeholder="WordPress, Shopify, comma-separated"
                  />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Careers page URL</Label>
                  <Input value={careersUrl} onChange={(e) => setCareersUrl(e.target.value)} placeholder="https://…" />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Contact</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>First name</Label>
                  <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
                </div>
                <div className="grid gap-1.5">
                  <Label>Last name</Label>
                  <Input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Role / title</Label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Seniority</Label>
                  <Input value={seniority} onChange={(e) => setSeniority(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Contact location</Label>
                  <Input value={contactLocation} onChange={(e) => setContactLocation(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Primary email (company)</Label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Personal email (optional)</Label>
                  <Input type="email" value={personalEmail} onChange={(e) => setPersonalEmail(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Email verification</Label>
                  <Select
                    value={emailVerify}
                    onValueChange={(v) => v && setEmailVerify(v as EmailVerificationStatus | typeof UNSET)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Not set</SelectItem>
                      {EMAIL_VERIFY_OPTS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Phone</Label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Contact source</Label>
                  <Input
                    value={contactSource}
                    onChange={(e) => setContactSource(e.target.value)}
                    placeholder="LinkedIn, Google Maps, Crunchbase…"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Best contact channel</Label>
                  <Select
                    value={bestChannel}
                    onValueChange={(v) => v && setBestChannel(v as BestContactChannel | typeof UNSET)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Not set</SelectItem>
                      {BEST_CHANNEL_OPTS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>LinkedIn profile URL</Label>
                  <Input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://linkedin.com/in/…" />
                </div>
              </div>
            </section>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
