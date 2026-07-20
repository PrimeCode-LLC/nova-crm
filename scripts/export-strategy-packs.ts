/**
 * Writes portable StrategyPack JSON files from TypeScript seed builders.
 *
 * Usage (from crm/):
 *   npx --yes tsx scripts/export-strategy-packs.ts
 *
 * Outputs:
 *   packs/template.empty.json          — canonical empty template (public)
 *   packs/sample-b2b-saas.json         — neutral product sample (public)
 *   packs/private/stellix-master.json  — Stellix master (gitignored)
 *   packs/private/stellix-supply-chain.json — logistics / Person 1 (gitignored)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { emptyStrategyPackTemplate, strategyToPack } from "../src/lib/prospecting-strategy/pack";
import { buildSampleB2bSaasPack } from "../src/lib/prospecting-strategy/sample-pack";
import { buildSeedPersonas, buildSeedStrategy } from "../src/lib/prospecting-strategy/seed";
import {
  buildPerson1Personas,
  buildPerson1Strategy,
} from "../src/lib/prospecting-strategy/person1-seed";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packsDir = join(root, "packs");
const privateDir = join(packsDir, "private");

function write(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log("wrote", path);
}

const ORG = "export-org";
const USER = "export-user";

write(join(packsDir, "template.empty.json"), emptyStrategyPackTemplate());
write(join(packsDir, "sample-b2b-saas.json"), buildSampleB2bSaasPack());

{
  const personas = buildSeedPersonas(ORG, USER);
  const strategy = buildSeedStrategy(ORG, USER);
  write(
    join(privateDir, "stellix-master.json"),
    strategyToPack({
      packId: "stellix-master",
      name: strategy.name,
      description:
        "PRIVATE — Stellix Soft master ICP. Import only into your org. Not a product default.",
      strategy,
      personas,
    }),
  );
}

{
  const personas = buildPerson1Personas(ORG, USER);
  const strategy = buildPerson1Strategy(ORG, USER);
  write(
    join(privateDir, "stellix-supply-chain.json"),
    strategyToPack({
      packId: "stellix-supply-chain",
      name: strategy.name,
      description:
        "PRIVATE — Supply chain / logistics / Person 1 pack. Import only into your org. Not a product default.",
      strategy,
      personas,
    }),
  );
}

console.log("Done.");
