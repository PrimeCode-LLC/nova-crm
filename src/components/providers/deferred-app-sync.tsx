"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { AlertSoundUnlock } from "@/components/providers/alert-sound-unlock";
import { EmailAccountSync } from "@/components/providers/email-account-sync";

const InboxBackgroundSync = dynamic(
  () => import("@/components/providers/inbox-background-sync").then((m) => ({ default: m.InboxBackgroundSync })),
  { ssr: false },
);
const ScheduledEmailSendSync = dynamic(
  () =>
    import("@/components/providers/scheduled-email-send-sync").then((m) => ({
      default: m.ScheduledEmailSendSync,
    })),
  { ssr: false },
);
const FollowupPlanReplyWatcher = dynamic(
  () =>
    import("@/components/providers/followup-plan-reply-watcher").then((m) => ({
      default: m.FollowupPlanReplyWatcher,
    })),
  { ssr: false },
);
const EmailBounceWatcher = dynamic(
  () =>
    import("@/components/providers/email-bounce-watcher").then((m) => ({
      default: m.EmailBounceWatcher,
    })),
  { ssr: false },
);
const LeadResponseTimeSync = dynamic(
  () => import("@/components/providers/lead-response-time-sync").then((m) => ({ default: m.LeadResponseTimeSync })),
  { ssr: false },
);
const PlatformNotificationsAlertSync = dynamic(
  () =>
    import("@/components/providers/platform-notifications-alert-sync").then((m) => ({
      default: m.PlatformNotificationsAlertSync,
    })),
  { ssr: false },
);
const FollowupDueNotificationSync = dynamic(
  () =>
    import("@/components/providers/followup-due-notification-sync").then((m) => ({
      default: m.FollowupDueNotificationSync,
    })),
  { ssr: false },
);
const ChannelAdminSync = dynamic(
  () => import("@/components/providers/channel-admin-sync").then((m) => ({ default: m.ChannelAdminSync })),
  { ssr: false },
);
const ActivityAuditTracker = dynamic(
  () => import("@/components/providers/activity-audit-tracker").then((m) => ({ default: m.ActivityAuditTracker })),
  { ssr: false },
);
const GlobalErrorListener = dynamic(
  () =>
    import("@/components/providers/global-error-listener").then((m) => ({
      default: m.GlobalErrorListener,
    })),
  { ssr: false },
);

function needsFollowupReplyWatcher(pathname: string) {
  return (
    pathname.startsWith("/inbox") ||
    pathname.startsWith("/leads") ||
    pathname.startsWith("/followups")
  );
}

function needsLeadResponseTimeSync(pathname: string) {
  return pathname === "/dashboard" || pathname.startsWith("/leads");
}

function needsChannelAdminSync(pathname: string) {
  return pathname.startsWith("/admin") || pathname === "/activity";
}

/**
 * Mounts background sync jobs after idle, scoped to routes that need them.
 */
export function DeferredAppSync() {
  const pathname = usePathname();
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    const activate = () => setReady(true);
    if (typeof requestIdleCallback !== "undefined") {
      const id = requestIdleCallback(activate, { timeout: 2500 });
      return () => cancelIdleCallback(id);
    }
    const timer = window.setTimeout(activate, 150);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
      {/* Mailbox hydrate must not wait on idle - settings/inbox need real boxes ASAP */}
      <EmailAccountSync />
      <GlobalErrorListener />
      {ready ? (
        <>
          <AlertSoundUnlock />
          <InboxBackgroundSync />
          <ScheduledEmailSendSync />
          <PlatformNotificationsAlertSync />
          <FollowupDueNotificationSync />
          <ActivityAuditTracker />
          <EmailBounceWatcher />
          {needsFollowupReplyWatcher(pathname) ? <FollowupPlanReplyWatcher /> : null}
          {needsLeadResponseTimeSync(pathname) ? <LeadResponseTimeSync /> : null}
          {needsChannelAdminSync(pathname) ? <ChannelAdminSync /> : null}
        </>
      ) : null}
    </>
  );
}
