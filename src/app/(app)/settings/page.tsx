"use client";

import * as React from "react";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { mockUsers, CURRENT_USER_ID } from "@/lib/mock-data";
import { initials } from "@/lib/format";
import {
  User,
  Building2,
  Bell,
  Plug,
  Palette,
  CreditCard,
  Check,
  X,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

const currentUser = mockUsers.find((u) => u.id === CURRENT_USER_ID)!;

const INTEGRATIONS = [
  { id: "instantly", name: "Instantly", desc: "Cold email automation: sends, tracks opens/replies.", connected: false },
  { id: "apollo", name: "Apollo", desc: "Lead enrichment and contact data.", connected: false },
  { id: "outlook", name: "Outlook / Exchange", desc: "Sync email threads to lead timeline.", connected: false },
  { id: "linkedin", name: "LinkedIn Sales Nav", desc: "Import connection data + sequence tracking.", connected: false },
  { id: "upwork", name: "Upwork", desc: "Sync proposal status and contract metrics.", connected: false },
  { id: "make", name: "Make.com", desc: "Workflow automation and Zapier alternative.", connected: false },
  { id: "website", name: "Website Webhook", desc: "Inbound form submissions as new leads.", connected: true },
];

export default function SettingsPage() {
  const [displayName, setDisplayName] = React.useState(currentUser.displayName);
  const [email] = React.useState(currentUser.email);
  const [title, setTitle] = React.useState(currentUser.title ?? "");
  const [savingProfile, setSavingProfile] = React.useState(false);

  const [notifications, setNotifications] = React.useState({
    emailNotifs: true,
    slackNotifs: false,
    leadAssigned: true,
    dailyDigest: true,
    weeklyScorecard: false,
  });

  const [theme, setTheme] = React.useState("dark");
  const [density, setDensity] = React.useState("comfortable");

  async function handleSaveProfile() {
    setSavingProfile(true);
    await new Promise((r) => setTimeout(r, 800));
    setSavingProfile(false);
    toast.success("Profile saved");
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage your profile, preferences, and integrations."
      />
      <PageBody>
        <Tabs defaultValue="profile">
          <TabsList className="mb-2">
            <TabsTrigger value="profile" className="gap-1.5">
              <User className="h-3.5 w-3.5" /> Profile
            </TabsTrigger>
            <TabsTrigger value="account" className="gap-1.5">
              <Building2 className="h-3.5 w-3.5" /> Account
            </TabsTrigger>
            <TabsTrigger value="notifications" className="gap-1.5">
              <Bell className="h-3.5 w-3.5" /> Notifications
            </TabsTrigger>
            <TabsTrigger value="integrations" className="gap-1.5">
              <Plug className="h-3.5 w-3.5" /> Integrations
            </TabsTrigger>
            <TabsTrigger value="appearance" className="gap-1.5">
              <Palette className="h-3.5 w-3.5" /> Appearance
            </TabsTrigger>
            <TabsTrigger value="billing" className="gap-1.5">
              <CreditCard className="h-3.5 w-3.5" /> Billing
            </TabsTrigger>
          </TabsList>

          {/* Profile */}
          <TabsContent value="profile">
            <Card className="max-w-lg">
              <CardHeader>
                <CardTitle className="text-sm">Personal information</CardTitle>
                <CardDescription className="text-xs">
                  Update your name, title, and email visible to teammates.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <Avatar className="h-14 w-14 rounded-md">
                    <AvatarFallback className="rounded-md bg-primary/15 text-primary text-lg font-semibold">
                      {initials(currentUser.displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <Button variant="outline" size="sm">
                      Change avatar
                    </Button>
                    <p className="text-xs text-muted-foreground mt-1">
                      JPG, PNG up to 2MB
                    </p>
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5 col-span-2 sm:col-span-1">
                    <Label className="text-xs">Display name</Label>
                    <Input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5 col-span-2 sm:col-span-1">
                    <Label className="text-xs">Title</Label>
                    <Input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Senior SDR"
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs">Email</Label>
                    <Input value={email} disabled className="h-9 opacity-60" />
                    <p className="text-[11px] text-muted-foreground">
                      Contact your admin to change your email address.
                    </p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button size="sm" onClick={handleSaveProfile} disabled={savingProfile}>
                    {savingProfile ? "Saving…" : "Save profile"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Account */}
          <TabsContent value="account">
            <Card className="max-w-lg">
              <CardHeader>
                <CardTitle className="text-sm">Workspace settings</CardTitle>
                <CardDescription className="text-xs">
                  Manage your organization name and preferences.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Organization name</Label>
                  <Input defaultValue="Nova Inc." className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Default timezone</Label>
                  <Input defaultValue="UTC+5 (PKT)" className="h-9" />
                </div>
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => toast.success("Account settings saved")}>
                    Save changes
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Notifications */}
          <TabsContent value="notifications">
            <Card className="max-w-lg">
              <CardHeader>
                <CardTitle className="text-sm">Notification preferences</CardTitle>
                <CardDescription className="text-xs">
                  Choose where and what you get notified about.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1 divide-y">
                {[
                  { key: "emailNotifs", label: "Email notifications", desc: "Receive activity summaries via email." },
                  { key: "slackNotifs", label: "Slack notifications", desc: "Get pinged in your Slack workspace." },
                  { key: "leadAssigned", label: "Lead assigned", desc: "When a lead is assigned or reassigned to you." },
                  { key: "dailyDigest", label: "Daily digest", desc: "Morning summary of your open pipeline." },
                  { key: "weeklyScorecard", label: "Weekly scorecard", desc: "Performance summary every Monday." },
                ].map(({ key, label, desc }) => (
                  <div key={key} className="flex items-center justify-between py-3 gap-3">
                    <div>
                      <div className="text-sm font-medium">{label}</div>
                      <div className="text-xs text-muted-foreground">{desc}</div>
                    </div>
                    <Switch
                      checked={notifications[key as keyof typeof notifications]}
                      onCheckedChange={(v) => {
                        setNotifications((prev) => ({ ...prev, [key]: !!v }));
                        toast.success(`${label}: ${!!v ? "on" : "off"}`);
                      }}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Integrations */}
          <TabsContent value="integrations">
            <div className="max-w-lg space-y-3">
              {INTEGRATIONS.map((int) => (
                <Card key={int.id}>
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground font-semibold text-sm shrink-0">
                      {int.name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{int.name}</span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            int.connected
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {int.connected ? (
                            <><Check className="h-2.5 w-2.5" /> Connected</>
                          ) : (
                            <><X className="h-2.5 w-2.5" /> Not connected</>
                          )}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {int.desc}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() =>
                        toast.info(
                          int.connected ? `Configure ${int.name}` : `Connect ${int.name} (coming soon)`,
                        )
                      }
                    >
                      {int.connected ? (
                        <>
                          <ExternalLink className="h-3.5 w-3.5" /> Configure
                        </>
                      ) : (
                        "Connect"
                      )}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Appearance */}
          <TabsContent value="appearance">
            <Card className="max-w-lg">
              <CardHeader>
                <CardTitle className="text-sm">Appearance</CardTitle>
                <CardDescription className="text-xs">
                  Customize your visual experience.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Theme
                  </Label>
                  <RadioGroup
                    value={theme}
                    onValueChange={(v) => {
                      setTheme(v);
                      toast.success(`Theme set to ${v}`);
                    }}
                    className="grid grid-cols-3 gap-3"
                  >
                    {["light", "dark", "system"].map((t) => (
                      <div key={t}>
                        <RadioGroupItem value={t} id={`theme-${t}`} className="sr-only" />
                        <Label
                          htmlFor={`theme-${t}`}
                          className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 cursor-pointer text-xs capitalize transition-colors ${
                            theme === t
                              ? "border-primary bg-primary/5 text-primary"
                              : "hover:bg-muted/30"
                          }`}
                        >
                          <div className={`h-8 w-full rounded-md ${t === "light" ? "bg-zinc-100" : t === "dark" ? "bg-zinc-900 border" : "bg-gradient-to-r from-zinc-100 to-zinc-900"}`} />
                          {t}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Density
                  </Label>
                  <RadioGroup
                    value={density}
                    onValueChange={(v) => {
                      setDensity(v);
                      toast.success(`Density set to ${v}`);
                    }}
                    className="grid grid-cols-2 gap-3"
                  >
                    {[
                      { value: "compact", label: "Compact", desc: "Denser rows, less whitespace." },
                      { value: "comfortable", label: "Comfortable", desc: "More breathing room." },
                    ].map((opt) => (
                      <div key={opt.value}>
                        <RadioGroupItem value={opt.value} id={`density-${opt.value}`} className="sr-only" />
                        <Label
                          htmlFor={`density-${opt.value}`}
                          className={`flex flex-col gap-1 rounded-lg border p-3 cursor-pointer transition-colors ${
                            density === opt.value
                              ? "border-primary bg-primary/5 text-primary"
                              : "hover:bg-muted/30"
                          }`}
                        >
                          <span className="text-sm font-medium">{opt.label}</span>
                          <span className="text-xs text-muted-foreground font-normal">{opt.desc}</span>
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Accent color
                  </Label>
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-md bg-indigo-600 ring-2 ring-indigo-600/40 ring-offset-2 ring-offset-background" />
                    <div>
                      <div className="text-sm font-medium">Indigo</div>
                      <div className="text-xs text-muted-foreground">
                        Default accent. More colors in v2.
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Billing */}
          <TabsContent value="billing">
            <Card className="max-w-lg">
              <CardHeader>
                <CardTitle className="text-sm">Billing</CardTitle>
                <CardDescription className="text-xs">
                  Manage your subscription and invoices.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border bg-muted/20 p-6 text-center space-y-3">
                  <CreditCard className="h-8 w-8 mx-auto text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Billing is managed by your admin</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Contact your workspace admin or reach out to support for billing changes.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toast.info("Contact admin for billing changes")}
                  >
                    Contact admin
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}
