import type { ChannelKey, Profile } from "@/lib/types";
import {
  OPPORTUNITY_SOURCE_TYPES,
  type OpportunitySourceType,
} from "@/lib/ai/opportunity-fit-types";

/** Default Fit Check categories inferred from outreach channel when not set on profile. */
export function defaultFitCategoriesForChannel(channel: ChannelKey): OpportunitySourceType[] {
  switch (channel) {
    case "upwork":
      return ["upwork"];
    case "job_apply":
      return ["job_apply"];
    case "personalized_email":
    case "website_form":
      return ["inbound", "other"];
    case "cold_email":
    case "linkedin_outbound":
    case "linkedin_1to1":
      return ["cold_outbound", "other"];
    default:
      return ["other"];
  }
}

export function profileFitCategories(profile: Profile): OpportunitySourceType[] {
  const explicit = profile.fitCheckCategories?.filter((c) =>
    OPPORTUNITY_SOURCE_TYPES.includes(c),
  );
  if (explicit && explicit.length > 0) return explicit;
  return defaultFitCategoriesForChannel(profile.channel);
}

export function profileMatchesFitSource(
  profile: Profile,
  sourceType: OpportunitySourceType,
): boolean {
  if (!profile.active) return false;
  return profileFitCategories(profile).includes(sourceType);
}

export function filterProfilesForFitSource(
  profiles: Profile[],
  sourceType: OpportunitySourceType,
): Profile[] {
  return profiles
    .filter((p) => profileMatchesFitSource(p, sourceType))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function profileDisplayLabel(profile: Profile): string {
  const stack = profile.stackLabel?.trim();
  if (stack && stack !== profile.name.trim()) {
    return `${profile.name} · ${stack}`;
  }
  return profile.name.trim();
}
