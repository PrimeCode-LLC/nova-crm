/**
 * One-shot local bootstrap: enable Demo org AI + full grants for Ariyan.
 * Usage: npx tsx scripts/grant-local-demo-full-access.ts
 */
import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { updateOrganizationAiSettingsServer } from "../src/lib/ai/ai-settings-server";
import { DEFAULT_AI_SETTINGS, type AiFeatureKey } from "../src/lib/ai/types";
import { ADMIN_FEATURES, type AdminFeatureKey } from "../src/lib/admin-features";
import { getAdminDb } from "../src/lib/db/document-access/admin";
import { COLLECTIONS } from "../src/lib/documents/collections";
import { canUseAiFeature, getOrganizationAiSettingsServer } from "../src/lib/ai/ai-settings-server";

const ORG_ID = "4cc6a670-529b-4bf0-8c7b-0dcdefc95d77";
const UID = "user_3J3HYfmGDjDPkVdHxTKtElZGRWM";
const ALL_ROLES = ["director", "manager", "team_lead", "salesperson", "data_scraper"] as const;

async function main() {
  const allFeatureKeys = Object.keys(DEFAULT_AI_SETTINGS.features) as AiFeatureKey[];
  const features = Object.fromEntries(
    allFeatureKeys.map((key) => [
      key,
      {
        ...DEFAULT_AI_SETTINGS.features[key],
        enabled: true,
        allowedRoles: [...ALL_ROLES],
      },
    ]),
  ) as typeof DEFAULT_AI_SETTINGS.features;

  const aiResult = await updateOrganizationAiSettingsServer(ORG_ID, {
    enabled: true,
    defaultProvider: "openai",
    defaultModel: "gpt-4o-mini",
    features,
  });
  console.info("[grant] ai settings", aiResult);

  const allGrants = Object.keys(ADMIN_FEATURES) as AdminFeatureKey[];
  const db = getAdminDb();
  if (!db) throw new Error("DATABASE_URL / document store not configured");

  const userRef = db.collection(COLLECTIONS.users).doc(UID);
  await userRef.set(
    {
      roleId: "director",
      orgRole: "owner",
      isSuperAdmin: true,
      featureGrants: allGrants,
      displayName: "Ariyan Arshad",
      email: "ariyanarshad11@gmail.com",
      name: "Ariyan Arshad",
      company: "Demo",
      organizationId: ORG_ID,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  const settings = await getOrganizationAiSettingsServer(ORG_ID);
  const user = (await userRef.get()).data();
  console.info("[grant] org AI enabled:", settings.enabled);
  console.info(
    "[grant] followup_suggest for director:",
    canUseAiFeature(settings, "followup_suggest", "director"),
  );
  console.info("[grant] user roleId:", user?.roleId, "grants:", (user?.featureGrants as string[] | undefined)?.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
