"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
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
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useAuth } from "@/components/providers/auth-provider";
import { initials } from "@/lib/format";
import { useTheme } from "next-themes";
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
  Sun,
  Moon,
  Monitor,
  Mail,
} from "lucide-react";
import { toast } from "sonner";
import { EmailInboxSettingsCard } from "@/components/settings/email-inbox-settings-card";

/**
 * Mini theme preview, a tiny faux-app rendered with the literal hex/oklch
 * palette of each theme so users can see what they'll get without applying it.
 * Kept self-contained (no theme tokens) so each card always shows its own theme.
 */
function ThemePreview({ kind }: { kind: "light" | "dark" | "system" }) {
  const palettes = {
    light: {
      bg: "oklch(0.995 0.002 265)",
      sidebar: "oklch(0.975 0.005 265)",
      card: "oklch(1 0 0)",
      border: "oklch(0.9 0.005 265)",
      muted: "oklch(0.965 0.005 265)",
      mutedFg: "oklch(0.44 0.015 265)",
      fg: "oklch(0.18 0.01 265)",
      primary: "oklch(0.5 0.2 265)",
    },
    dark: {
      bg: "oklch(0.14 0 0)",
      sidebar: "oklch(0.155 0 0)",
      card: "oklch(0.175 0 0)",
      border: "oklch(1 0 0 / 8%)",
      muted: "oklch(0.23 0 0)",
      mutedFg: "oklch(0.65 0 0)",
      fg: "oklch(0.98 0 0)",
      primary: "oklch(0.7 0.17 265)",
    },
  } as const;

  if (kind === "system") {
    return (
      <div className="relative h-16 w-full overflow-hidden rounded-md border">
        <div className="absolute inset-y-0 left-0 w-1/2 overflow-hidden">
          <ThemePreviewInner p={palettes.light} />
        </div>
        <div
          className="absolute inset-y-0 right-0 w-1/2 overflow-hidden"
          style={{ clipPath: "polygon(8% 0, 100% 0, 100% 100%, 0 100%)" }}
        >
          <ThemePreviewInner p={palettes.dark} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-16 w-full overflow-hidden rounded-md border">
      <ThemePreviewInner p={palettes[kind]} />
    </div>
  );
}

function ThemePreviewInner({
  p,
}: {
  p: {
    bg: string;
    sidebar: string;
    card: string;
    border: string;
    muted: string;
    mutedFg: string;
    fg: string;
    primary: string;
  };
}) {
  return (
    <div
      className="flex h-full w-full"
      style={{ background: p.bg, color: p.fg }}
    >
      <div
        className="flex w-1/3 flex-col gap-1 border-r p-1.5"
        style={{ background: p.sidebar, borderColor: p.border }}
      >
        <div
          className="h-1 w-3/4 rounded-full"
          style={{ background: p.primary }}
        />
        <div
          className="h-1 w-2/3 rounded-full"
          style={{ background: p.mutedFg, opacity: 0.5 }}
        />
        <div
          className="h-1 w-1/2 rounded-full"
          style={{ background: p.mutedFg, opacity: 0.5 }}
        />
      </div>
      <div className="flex flex-1 flex-col gap-1 p-1.5">
        <div
          className="h-2 w-full rounded-sm border"
          style={{ background: p.card, borderColor: p.border }}
        />
        <div
          className="h-1.5 w-3/4 rounded-full"
          style={{ background: p.muted }}
        />
        <div
          className="mt-auto h-2.5 w-8 rounded-sm"
          style={{ background: p.primary }}
        />
      </div>
    </div>
  );
}

const INTEGRATIONS = [
  { id: "instantly", name: "Instantly", desc: "Cold email automation: sends, tracks opens/replies.", connected: false },
  { id: "apollo", name: "Apollo", desc: "Lead enrichment and contact data.", connected: false },
  { id: "outlook", name: "Outlook / Exchange", desc: "Sync email threads to lead timeline.", connected: false },
  { id: "linkedin", name: "LinkedIn Sales Nav", desc: "Import connection data + sequence tracking.", connected: false },
  { id: "upwork", name: "Upwork", desc: "Sync proposal status and contract metrics.", connected: false },
  { id: "make", name: "Make.com", desc: "Workflow automation and Zapier alternative.", connected: false },
  { id: "website", name: "Website Webhook", desc: "Inbound form submissions as new leads.", connected: true },
];

function SettingsPage() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = React.useState("profile");

  React.useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "email") setActiveTab("email");
  }, [searchParams]);

  const { isDemo, users, currentUserId, demoPersonaId } = useWorkspace();
  const { user: fbUser } = useAuth();
  const demoUser = users.find((u) => u.id === currentUserId);

  const [displayName, setDisplayName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [title, setTitle] = React.useState("");

  React.useEffect(() => {
    if (isDemo && demoUser) {
      setDisplayName(demoUser.displayName);
      setEmail(demoUser.email);
      setTitle(demoUser.title ?? "");
    } else if (fbUser) {
      setDisplayName(fbUser.displayName || fbUser.email?.split("@")[0] || "");
      setEmail(fbUser.email ?? "");
      setTitle("");
    } else {
      setDisplayName(demoUser?.displayName ?? "");
      setEmail(demoUser?.email ?? "");
      setTitle(demoUser?.title ?? "");
    }
  }, [isDemo, currentUserId, demoPersonaId, demoUser, fbUser]);
  const [savingProfile, setSavingProfile] = React.useState(false);

  const [notifications, setNotifications] = React.useState({
    emailNotifs: true,
    slackNotifs: false,
    leadAssigned: true,
    dailyDigest: true,
    weeklyScorecard: false,
  });

  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const activeTheme = mounted ? (theme ?? "system") : "dark";
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
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-2 flex-wrap h-auto gap-1 py-1">
            <TabsTrigger value="profile" className="gap-1.5">
              <User className="h-3.5 w-3.5" /> Profile
            </TabsTrigger>
            <TabsTrigger value="account" className="gap-1.5">
              <Building2 className="h-3.5 w-3.5" /> Account
            </TabsTrigger>
            <TabsTrigger value="notifications" className="gap-1.5">
              <Bell className="h-3.5 w-3.5" /> Notifications
            </TabsTrigger>
            <TabsTrigger value="email" className="gap-1.5">
              <Mail className="h-3.5 w-3.5" /> Email
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
                  {isDemo && (
                    <span className="block mt-1 text-warning">
                      Demo mode: profile below matches sample data. Switch to Workspace in the top bar for your account.
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <Avatar className="h-14 w-14 rounded-md">
                    <AvatarFallback className="rounded-md bg-primary/15 text-primary text-lg font-semibold">
                      {initials(displayName || "?")}
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

          {/* Email / SMTP inbox */}
          <TabsContent value="email">
            <EmailInboxSettingsCard />
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
                              ? "bg-success/10 text-success border-success/20"
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
                    value={activeTheme}
                    onValueChange={(v) => {
                      setTheme(v);
                      toast.success(
                        v === "system" ? "Theme follows your system" : `Theme set to ${v}`,
                      );
                    }}
                    className="grid grid-cols-3 gap-3"
                  >
                    {(
                      [
                        { value: "light", label: "Light", Icon: Sun },
                        { value: "dark", label: "Dark", Icon: Moon },
                        { value: "system", label: "System", Icon: Monitor },
                      ] as const
                    ).map(({ value, label, Icon }) => {
                      const isActive = activeTheme === value;
                      return (
                        <div key={value}>
                          <RadioGroupItem
                            value={value}
                            id={`theme-${value}`}
                            className="sr-only"
                          />
                          <Label
                            htmlFor={`theme-${value}`}
                            className={`group relative flex flex-col gap-2 rounded-lg border p-2 cursor-pointer transition-colors ${
                              isActive
                                ? "border-primary ring-1 ring-primary/40"
                                : "hover:bg-muted/30"
                            }`}
                          >
                            <ThemePreview kind={value} />
                            <div className="flex items-center gap-1.5 px-1">
                              <Icon
                                className={`h-3.5 w-3.5 ${isActive ? "text-primary" : "text-muted-foreground"}`}
                              />
                              <span
                                className={`text-xs font-medium ${isActive ? "text-primary" : ""}`}
                              >
                                {label}
                              </span>
                              {isActive && (
                                <Check className="ml-auto h-3 w-3 text-primary" />
                              )}
                            </div>
                          </Label>
                        </div>
                      );
                    })}
                  </RadioGroup>
                  <p className="text-[11px] text-muted-foreground">
                    {activeTheme === "system"
                      ? "Follows your OS appearance. Updates automatically when your system theme changes."
                      : activeTheme === "dark"
                        ? "Default. Best for long sessions and low-light rooms."
                        : "Soft warm whites with refined indigo accent."}
                  </p>
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
                    <div className="h-8 w-8 rounded-md bg-primary ring-2 ring-primary/40 ring-offset-2 ring-offset-background" />
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

function SettingsFallback() {
  return (
    <>
      <PageHeader title="Settings" description="Loading preferences…" />
      <PageBody>
        <div className="h-48 max-w-lg animate-pulse rounded-lg bg-muted/40" />
      </PageBody>
    </>
  );
}

export default function SettingsPageRoute() {
  return (
    <Suspense fallback={<SettingsFallback />}>
      <SettingsPage />
    </Suspense>
  );
}
