/**
 * One-shot: store OpenAI provider key for local Demo org.
 * Usage: npx tsx scripts/set-local-openai-key.ts
 * Reads key from OPENAI_API_KEY env (do not commit keys).
 */
import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

import { upsertAiProviderKeysServer, getAiProviderKeyFlagsServer } from "../src/lib/ai/ai-secrets-server";

const ORG_ID = "4cc6a670-529b-4bf0-8c7b-0dcdefc95d77";

async function main() {
  const openai = process.env.OPENAI_API_KEY?.trim();
  if (!openai) {
    console.error("Set OPENAI_API_KEY in the environment for this script.");
    process.exit(1);
  }
  const result = await upsertAiProviderKeysServer({
    organizationId: ORG_ID,
    keys: { openai },
  });
  if ("error" in result) {
    console.error(result.error);
    process.exit(1);
  }
  const flags = await getAiProviderKeyFlagsServer(ORG_ID);
  console.info("[set-local-openai-key] ok", flags);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
