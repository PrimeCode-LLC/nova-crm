import type { Role } from "./types";

/** Sales + intake roles: surface personal follow-ups and tasks above org-wide KPIs. */
export function isFrontlineDashboardRole(role: Role | undefined): boolean {
  return role === "salesperson" || role === "data_scraper" || role === "prospecting";
}

/** Show a second bucket of teammates’ open follow-ups (workspace is already hierarchy-scoped). */
export function showTeamFollowupsOnDashboard(role: Role | undefined): boolean {
  return role === "director" || role === "manager" || role === "team_lead";
}

export function getDashboardOverviewDescription(role: Role | undefined): string {
  switch (role) {
    case "director":
      return "Org-wide pipeline, channel health, and where the team is stuck, with your own commitments in view.";
    case "manager":
      return "Team coverage, pipeline risk, and follow-through across your reports.";
    case "team_lead":
      return "Squad pipeline, coaching signals, and the next actions your reps owe.";
    case "salesperson":
      return "Your next follow-ups and tasks first, then pipeline context for the leads you own.";
    case "data_scraper":
    case "prospecting":
      return "Intake and handoff work in focus, plus pipeline context for leads you touch.";
    default:
      return "Live pipeline state, team performance, and funnel diagnostics.";
  }
}

export function getDashboardRoleFocusLine(role: Role | undefined): string {
  switch (role) {
    case "director":
      return "Prioritize idle companies, channel mix, and revenue concentration, then drill into any rep.";
    case "manager":
      return "Watch overdue follow-ups on the team, funnel drop-offs, and idle leads in your scope.";
    case "team_lead":
      return "Balance rep-level follow-ups with funnel stages where the team stalls.";
    case "salesperson":
      return "Clear due follow-ups and assigned tasks before diving into charts.";
    case "data_scraper":
    case "prospecting":
      return "Keep source quality high: resolve follow-ups tied to your leads and handoffs.";
    default:
      return "Use filters to slice by channel or owner when you need a narrower view.";
  }
}
