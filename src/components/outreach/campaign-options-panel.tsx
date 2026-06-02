"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { InstantlyCampaign } from "@/lib/integrations/instantly/types";
import { cn } from "@/lib/utils";

type WorkspaceAccount = { email: string };

export type CampaignOptionsPatch = Partial<
  Pick<
    InstantlyCampaign,
    | "email_list"
    | "stop_on_reply"
    | "stop_on_auto_reply"
    | "stop_for_company"
    | "open_tracking"
    | "link_tracking"
    | "text_only"
    | "first_email_text_only"
    | "daily_limit"
    | "daily_max_leads"
    | "email_gap"
    | "random_wait_max"
    | "prioritize_new_leads"
    | "insert_unsubscribe_header"
    | "match_lead_esp"
    | "allow_risky_contacts"
    | "disable_bounce_protect"
  >
>;

const VISIBLE_ACCOUNTS = 5;

function bool(v: boolean | null | undefined, fallback: boolean) {
  return v ?? fallback;
}

function num(v: number | null | undefined, fallback: number) {
  return v ?? fallback;
}

export function CampaignOptionsPanel({
  campaignId,
  remote,
  accounts,
  connected,
  isDemo,
  canEdit,
  onOptionsChange,
}: {
  campaignId: string;
  remote: InstantlyCampaign | null;
  accounts: string[];
  connected: boolean;
  isDemo: boolean;
  canEdit: boolean;
  onOptionsChange: (patch: CampaignOptionsPatch) => void;
}) {
  const [saving, setSaving] = React.useState(false);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [accountsOpen, setAccountsOpen] = React.useState(false);
  const [workspaceAccounts, setWorkspaceAccounts] = React.useState<WorkspaceAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = React.useState(false);

  const [demoOptions, setDemoOptions] = React.useState<CampaignOptionsPatch>({
    email_list: [],
    stop_on_reply: true,
    open_tracking: true,
    link_tracking: true,
    text_only: false,
    first_email_text_only: false,
    daily_limit: 100,
    stop_on_auto_reply: false,
    stop_for_company: false,
    prioritize_new_leads: false,
    daily_max_leads: 100,
    email_gap: 10,
    insert_unsubscribe_header: false,
    match_lead_esp: false,
  });

  React.useEffect(() => {
    if (!connected && !isDemo) return;
    setLoadingAccounts(true);
    void (async () => {
      try {
        const res = await fetch("/api/integrations/instantly/accounts");
        if (!res.ok) return;
        const data = (await res.json()) as { accounts?: { email: string }[] };
        setWorkspaceAccounts((data.accounts ?? []).filter((a) => a.email?.trim()));
      } finally {
        setLoadingAccounts(false);
      }
    })();
  }, [connected, isDemo]);

  const source = isDemo ? demoOptions : remote;
  const emailList = source?.email_list ?? accounts;
  const stopOnReply = bool(source?.stop_on_reply, true);
  const openTracking = bool(source?.open_tracking, true);
  const linkTracking = bool(source?.link_tracking, true);
  const textOnly = bool(source?.text_only, false);
  const firstEmailTextOnly = bool(source?.first_email_text_only, false);
  const dailyLimit = num(source?.daily_limit, 100);
  const stopOnAutoReply = bool(source?.stop_on_auto_reply, false);
  const stopForCompany = bool(source?.stop_for_company, false);
  const prioritizeNewLeads = bool(source?.prioritize_new_leads, false);
  const dailyMaxLeads = num(source?.daily_max_leads, 100);
  const emailGap = num(source?.email_gap, 10);
  const insertUnsubscribe = bool(source?.insert_unsubscribe_header, false);
  const matchLeadEsp = bool(source?.match_lead_esp, false);
  const allowRisky = bool(source?.allow_risky_contacts, false);
  const disableBounceProtect = bool(source?.disable_bounce_protect, false);

  const [dailyLimitDraft, setDailyLimitDraft] = React.useState(String(dailyLimit));
  const [dailyMaxLeadsDraft, setDailyMaxLeadsDraft] = React.useState(String(dailyMaxLeads));
  const [emailGapDraft, setEmailGapDraft] = React.useState(String(emailGap));

  React.useEffect(() => setDailyLimitDraft(String(dailyLimit)), [dailyLimit]);
  React.useEffect(() => setDailyMaxLeadsDraft(String(dailyMaxLeads)), [dailyMaxLeads]);
  React.useEffect(() => setEmailGapDraft(String(emailGap)), [emailGap]);

  async function save(patch: CampaignOptionsPatch) {
    if (!canEdit) return;
    setSaving(true);
    try {
      if (isDemo) {
        setDemoOptions((prev) => ({ ...prev, ...patch }));
        onOptionsChange(patch);
        return;
      }

      const res = await fetch(`/api/integrations/instantly/campaigns/${campaignId}/options`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string | { formErrors?: string[] };
        remote?: InstantlyCampaign;
      };
      if (!res.ok) {
        const msg =
          typeof data.error === "string"
            ? data.error
            : Array.isArray((data.error as { formErrors?: string[] })?.formErrors)
              ? (data.error as { formErrors: string[] }).formErrors[0]
              : "Could not update options";
        toast.error(msg);
        return;
      }
      const updated = data.remote ?? patch;
      onOptionsChange(updated);
    } finally {
      setSaving(false);
    }
  }

  function toggleAccount(email: string, checked: boolean) {
    const set = new Set(emailList.map((e) => e.toLowerCase()));
    if (checked) set.add(email.toLowerCase());
    else set.delete(email.toLowerCase());
    const next = [...set];
    if (next.length === 0) {
      toast.error("At least one sending account is required");
      return;
    }
    void save({ email_list: next });
  }

  function removeAccount(email: string) {
    const next = emailList.filter((e) => e.toLowerCase() !== email.toLowerCase());
    if (next.length === 0) {
      toast.error("At least one sending account is required");
      return;
    }
    void save({ email_list: next });
  }

  if (!connected && !isDemo) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <p className="text-sm text-muted-foreground">Connect Instantly to manage campaign options.</p>
      </div>
    );
  }

  if (!isDemo && !remote) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const visibleAccounts = emailList.slice(0, VISIBLE_ACCOUNTS);
  const hiddenCount = Math.max(0, emailList.length - VISIBLE_ACCOUNTS);

  return (
    <div className="space-y-3">
      {saving && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Saving…
        </div>
      )}

      {/* Accounts to use */}
      <OptionCard
        title="Accounts to use"
        description="Select one or more accounts to send emails from"
      >
        <Popover open={accountsOpen} onOpenChange={setAccountsOpen}>
          <PopoverTrigger
            disabled={!canEdit}
            render={
              <button
                type="button"
                disabled={!canEdit}
                className={cn(
                  "flex min-h-10 w-full max-w-md flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1.5 text-left text-sm",
                  !canEdit && "cursor-default opacity-80",
                )}
              >
                {emailList.length === 0 ? (
                  <span className="px-1 text-muted-foreground">No accounts selected</span>
                ) : (
                  <>
                    {visibleAccounts.map((email) => (
                      <AccountBadge
                        key={email}
                        email={email}
                        canEdit={canEdit}
                        onRemove={() => removeAccount(email)}
                      />
                    ))}
                    {hiddenCount > 0 && (
                      <span className="px-1 text-xs text-muted-foreground">+{hiddenCount} more</span>
                    )}
                  </>
                )}
                {canEdit && <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />}
              </button>
            }
          />
          <PopoverContent align="end" className="w-80 p-0">
            <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
              Workspace accounts
            </div>
            {loadingAccounts ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : workspaceAccounts.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">No accounts found.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto p-2">
                {workspaceAccounts.map((a) => (
                  <label
                    key={a.email}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={emailList.some((e) => e.toLowerCase() === a.email.toLowerCase())}
                      onCheckedChange={(checked) => toggleAccount(a.email, Boolean(checked))}
                    />
                    <span className="truncate font-mono text-xs">{a.email}</span>
                  </label>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </OptionCard>

      {/* Stop on reply */}
      <OptionCard
        title="Stop sending emails on reply"
        description="Stop sending emails to a lead if a response has been received"
      >
        <EnableDisableControl
          value={stopOnReply}
          disabled={!canEdit || saving}
          onChange={(v) => void save({ stop_on_reply: v })}
        />
      </OptionCard>

      {/* Open tracking */}
      <OptionCard title="Open Tracking" description="Track email opens">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={linkTracking}
              disabled={!canEdit || saving || !openTracking}
              onCheckedChange={(checked) => void save({ link_tracking: Boolean(checked) })}
            />
            Link tracking
          </label>
          <EnableDisableControl
            value={openTracking}
            disabled={!canEdit || saving}
            onChange={(v) => {
              const patch: CampaignOptionsPatch = { open_tracking: v };
              if (!v) patch.link_tracking = false;
              void save(patch);
            }}
          />
        </div>
      </OptionCard>

      {/* Delivery optimization */}
      <OptionCard
        title="Delivery Optimization"
        description={openTracking ? "Disables open tracking when text-only is enabled" : "Send plain-text emails for better deliverability"}
        badge="Recommended"
      >
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={textOnly}
              disabled={!canEdit || saving}
              onCheckedChange={(checked) => {
                const patch: CampaignOptionsPatch = { text_only: Boolean(checked) };
                if (checked) patch.open_tracking = false;
                void save(patch);
              }}
            />
            Send emails as text-only (no HTML)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={firstEmailTextOnly}
              disabled={!canEdit || saving}
              onCheckedChange={(checked) => void save({ first_email_text_only: Boolean(checked) })}
            />
            Send first email as text-only
          </label>
        </div>
      </OptionCard>

      {/* Daily limit */}
      <OptionCard
        title="Daily Limit"
        description="Max number of emails to send per day for this campaign"
      >
        <Input
          type="number"
          min={1}
          className="w-28 tabular-nums"
          value={dailyLimitDraft}
          disabled={!canEdit || saving}
          onChange={(e) => setDailyLimitDraft(e.target.value)}
          onBlur={() => {
            const n = parseInt(dailyLimitDraft, 10);
            if (Number.isNaN(n) || n < 1) {
              toast.error("Daily limit must be at least 1");
              setDailyLimitDraft(String(dailyLimit));
              return;
            }
            if (n !== dailyLimit) void save({ daily_limit: n });
          }}
        />
      </OptionCard>

      {/* Advanced */}
      <div className="pt-2">
        <Button
          variant="ghost"
          size="sm"
          className="mx-auto flex gap-2 text-muted-foreground"
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {advancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {advancedOpen ? "Hide advanced options" : "Show advanced options"}
        </Button>
      </div>

      {advancedOpen && (
        <div className="space-y-3 border-t pt-4">
          <OptionCard
            title="Stop on auto-reply"
            description="Pause the sequence when an out-of-office or auto-reply is detected"
          >
            <EnableDisableControl
              value={stopOnAutoReply}
              disabled={!canEdit || saving}
              onChange={(v) => void save({ stop_on_auto_reply: v })}
            />
          </OptionCard>

          <OptionCard
            title="Stop for company"
            description="Stop outreach to the entire company domain when one lead replies"
          >
            <EnableDisableControl
              value={stopForCompany}
              disabled={!canEdit || saving}
              onChange={(v) => void save({ stop_for_company: v })}
            />
          </OptionCard>

          <OptionCard
            title="Prioritize new leads"
            description="Contact newly added leads before continuing with existing ones"
          >
            <EnableDisableControl
              value={prioritizeNewLeads}
              disabled={!canEdit || saving}
              onChange={(v) => void save({ prioritize_new_leads: v })}
            />
          </OptionCard>

          <OptionCard
            title="Daily max new leads"
            description="Maximum new leads to contact per day"
          >
            <Input
              type="number"
              min={0}
              className="w-28 tabular-nums"
              value={dailyMaxLeadsDraft}
              disabled={!canEdit || saving}
              onChange={(e) => setDailyMaxLeadsDraft(e.target.value)}
              onBlur={() => {
                const n = parseInt(dailyMaxLeadsDraft, 10);
                if (Number.isNaN(n) || n < 0) {
                  toast.error("Must be 0 or greater");
                  setDailyMaxLeadsDraft(String(dailyMaxLeads));
                  return;
                }
                if (n !== dailyMaxLeads) void save({ daily_max_leads: n });
              }}
            />
          </OptionCard>

          <OptionCard
            title="Email gap (minutes)"
            description="Minimum wait time between consecutive sends from the same account"
          >
            <Input
              type="number"
              min={0}
              className="w-28 tabular-nums"
              value={emailGapDraft}
              disabled={!canEdit || saving}
              onChange={(e) => setEmailGapDraft(e.target.value)}
              onBlur={() => {
                const n = parseInt(emailGapDraft, 10);
                if (Number.isNaN(n) || n < 0) {
                  toast.error("Must be 0 or greater");
                  setEmailGapDraft(String(emailGap));
                  return;
                }
                if (n !== emailGap) void save({ email_gap: n });
              }}
            />
          </OptionCard>

          <OptionCard title="Match lead ESP" description="Route sends based on recipient email provider">
            <EnableDisableControl
              value={matchLeadEsp}
              disabled={!canEdit || saving}
              onChange={(v) => void save({ match_lead_esp: v })}
            />
          </OptionCard>

          <OptionCard
            title="Unsubscribe header"
            description="Insert a List-Unsubscribe header in outgoing emails"
          >
            <EnableDisableControl
              value={insertUnsubscribe}
              disabled={!canEdit || saving}
              onChange={(v) => void save({ insert_unsubscribe_header: v })}
            />
          </OptionCard>

          <OptionCard title="Allow risky contacts" description="Include leads flagged as risky by Instantly">
            <EnableDisableControl
              value={allowRisky}
              disabled={!canEdit || saving}
              onChange={(v) => void save({ allow_risky_contacts: v })}
            />
          </OptionCard>

          <OptionCard
            title="Disable bounce protection"
            description="Turn off Instantly bounce protection for this campaign"
          >
            <EnableDisableControl
              value={disableBounceProtect}
              disabled={!canEdit || saving}
              onChange={(v) => void save({ disable_bounce_protect: v })}
            />
          </OptionCard>
        </div>
      )}
    </div>
  );
}

function OptionCard({
  title,
  description,
  badge,
  children,
}: {
  title: string;
  description: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium">{title}</h3>
          {badge && (
            <Badge variant="outline" className="border-success/30 bg-success/10 text-[10px] text-success">
              {badge}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0 sm:max-w-md sm:flex-1 sm:pl-4">{children}</div>
    </div>
  );
}

function EnableDisableControl({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-input">
      <button
        type="button"
        disabled={disabled}
        className={cn(
          "px-4 py-1.5 text-sm transition-colors",
          !value ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/50",
        )}
        onClick={() => onChange(false)}
      >
        Disable
      </button>
      <button
        type="button"
        disabled={disabled}
        className={cn(
          "px-4 py-1.5 text-sm transition-colors",
          value ? "bg-success font-medium text-success-foreground" : "text-muted-foreground hover:bg-muted/50",
        )}
        onClick={() => onChange(true)}
      >
        Enable
      </button>
    </div>
  );
}

function AccountBadge({
  email,
  canEdit,
  onRemove,
}: {
  email: string;
  canEdit: boolean;
  onRemove: () => void;
}) {
  const local = email.split("@")[0];
  return (
    <span className="inline-flex max-w-[140px] items-center gap-0.5 rounded-md bg-muted px-1.5 py-0.5 text-xs">
      <span className="truncate">{local}</span>
      {canEdit && (
        <button
          type="button"
          className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
          aria-label={`Remove ${email}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
