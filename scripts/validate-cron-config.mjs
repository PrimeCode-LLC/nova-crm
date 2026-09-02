#!/usr/bin/env node
/**
 * Validates production cron sidecar configuration:
 * - crontab uses cron-dispatch.sh (POST), not wget GET
 * - job names match /api/cron/queue/dispatch route
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const crontab = readFileSync(path.join(root, "docker/cron/crontab"), "utf8");
const dispatchRoute = readFileSync(
  path.join(root, "src/app/api/cron/queue/dispatch/route.ts"),
  "utf8",
);

const jobsStart = dispatchRoute.indexOf("const JOBS = {");
const jobsEnd = dispatchRoute.indexOf("} as const", jobsStart);
if (jobsStart === -1 || jobsEnd === -1) {
  console.error("Could not locate JOBS block in dispatch route");
  process.exit(1);
}
const jobsBlock = dispatchRoute.slice(jobsStart, jobsEnd);
const supportedJobs = [
  ...jobsBlock.matchAll(/^\s*"([^"]+)":/gm),
  ...jobsBlock.matchAll(/^\s*([a-z][a-z0-9-]*)\s*:/gm),
].map((m) => m[1]);
const lines = crontab
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#") && !l.startsWith("SHELL") && !l.startsWith("PATH"));

const errors = [];

if (crontab.includes("wget")) {
  errors.push("crontab must not use wget GET against dispatch");
}

for (const line of lines) {
  if (!line.includes("cron-dispatch.sh")) {
    errors.push(`cron line must call cron-dispatch.sh: ${line}`);
    continue;
  }
  const match = line.match(/cron-dispatch\.sh\s+([a-z-]+)/);
  const jobArg = match?.[1];
  if (!jobArg || !supportedJobs.includes(jobArg)) {
    errors.push(`unknown or missing job in crontab line: ${line}`);
  }
}

const usedJobs = lines
  .map((l) => l.match(/cron-dispatch\.sh\s+([a-z-]+)/)?.[1])
  .filter(Boolean);
for (const job of supportedJobs) {
  if (!usedJobs.includes(job)) {
    errors.push(`supported job "${job}" is not scheduled in crontab`);
  }
}

if (errors.length) {
  console.error("Cron configuration validation failed:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`Cron configuration OK (${lines.length} schedules, ${supportedJobs.length} jobs)`);
