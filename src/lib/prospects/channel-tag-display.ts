import type { ChannelKey, Lead, ProspectChannelAssignment } from "@/lib/types";

function assignmentForChannel(
  assignments: ProspectChannelAssignment[],
  channel: ChannelKey,
): ProspectChannelAssignment | undefined {
  const matches = assignments.filter((a) => a.channel === channel);
  return matches.find((a) => a.pushedAt) ?? matches[0];
}

function tooltipFromAssignment(
  assignment: ProspectChannelAssignment,
  channelLabel: string,
  getUserName: (uid: string) => string | undefined,
): string {
  if (assignment.pushedAt && assignment.pushedByUserId) {
    const name = getUserName(assignment.pushedByUserId)?.trim() || "Teammate";
    return `${channelLabel} - Pushed by ${name}`;
  }
  const assignee = getUserName(assignment.assigneeId)?.trim() || "Teammate";
  return `${channelLabel} - Assigned to ${assignee}`;
}

/** Hover text for channel badges on prospects and prospect-derived sales leads. */
export function buildChannelTagTooltipMap(
  lead: Lead,
  allLeads: readonly Lead[],
  getUserName: (uid: string) => string | undefined,
  getChannelLabel: (channel: ChannelKey) => string,
): Map<ChannelKey, string> {
  const map = new Map<ChannelKey, string>();

  const applyAssignments = (assignments: ProspectChannelAssignment[] | undefined) => {
    if (!assignments?.length) return;
    const channels = [...new Set(assignments.map((a) => a.channel))];
    for (const channel of channels) {
      const assignment = assignmentForChannel(assignments, channel);
      if (!assignment) continue;
      map.set(channel, tooltipFromAssignment(assignment, getChannelLabel(channel), getUserName));
    }
  };

  if (lead.intakeKind === "prospect") {
    applyAssignments(lead.prospectChannelAssignments);
    return map;
  }

  const prospectId = lead.prospectSourceId?.trim();
  if (prospectId) {
    const prospect = allLeads.find((l) => l.id === prospectId);
    const assignments = prospect?.prospectChannelAssignments?.filter(
      (a) =>
        a.pushedAt &&
        (!lead.channelTags?.length || lead.channelTags.includes(a.channel)),
    );
    applyAssignments(assignments);
  }

  for (const channel of lead.channelTags ?? []) {
    if (!map.has(channel)) {
      map.set(channel, getChannelLabel(channel));
    }
  }

  return map;
}
