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
      return "Command board: live outreach, team scorecards, inbox leaders, and wall-ready ops pulse.";
    case "manager":
      return "Team coverage, outreach volume, follow-through, and where reps need help.";
    case "team_lead":
      return "Squad pipeline, coaching signals, and the next actions your reps owe.";
    case "salesperson":
      return "Your day first: due follow-ups, tasks, replies, then pipeline for leads you own.";
    case "data_scraper":
    case "prospecting":
      return "Route and push prospects, clear handoff work, then track replies on your intake.";
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
      return "Work My day top-down: overdue follow-ups and tasks, replies to review, then pipeline value.";
    case "data_scraper":
    case "prospecting":
      return "Clear prospects that need routing, push ready ones to sales, then review replies on handoffs.";
    default:
      return "Use filters to slice by channel or owner when you need a narrower view.";
  }
}
