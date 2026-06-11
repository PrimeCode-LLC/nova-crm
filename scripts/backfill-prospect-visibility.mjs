/**
 * Backfill missing prospect visibility fields on lead documents.
 *
 * Usage (from repo root, with Firebase Admin env vars set):
 *   node scripts/backfill-prospect-visibility.mjs
 *   node scripts/backfill-prospect-visibility.mjs --org=YOUR_ORG_ID
 *   node scripts/backfill-prospect-visibility.mjs --dry-run
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const orgArg = args.find((a) => a.startsWith("--org="));
const orgFilter = orgArg ? orgArg.slice("--org=".length).trim() : null;

const projectId =
  process.env.FIREBASE_ADMIN_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!projectId || !clientEmail || !privateKey) {
  console.error(
    "Missing FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, or FIREBASE_ADMIN_PRIVATE_KEY.",
  );
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

const db = getFirestore();

function isProspectCandidate(data) {
  if (data.intakeKind === "prospect") return true;
  if (data.prospectOwnerId || data.prospectVisibility || data.prospectChannelAssignments) {
    return true;
  }
  return false;
}

async function main() {
  let scanned = 0;
  let patched = 0;

  let q = db.collection("leads");
  if (orgFilter) {
    q = q.where("organizationId", "==", orgFilter);
  }

  const snap = await q.get();
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (!isProspectCandidate(data)) continue;
    scanned += 1;

    const patch = {};
    if (data.intakeKind !== "prospect") patch.intakeKind = "prospect";
    if (!data.prospectVisibility) {
      patch.prospectVisibility =
        (data.prospectChannelAssignments?.length ?? 0) > 0 ? "assigned" : "open";
    }
    if (!data.prospectOwnerId?.trim()) {
      const owner =
        data.prospectOwnerId?.trim() ||
        data.createdById?.trim() ||
        data.ownerId?.trim();
      if (owner) patch.prospectOwnerId = owner;
    }

    if (Object.keys(patch).length === 0) continue;

    patched += 1;
    console.log(
      `${dryRun ? "[dry-run] " : ""}Patch ${docSnap.id} (${data.organizationId ?? "?"})`,
      patch,
    );
    if (!dryRun) {
      await docSnap.ref.update(patch);
    }
  }

  console.log(`Done. Scanned ${scanned} prospect-like leads, ${patched} ${dryRun ? "would be " : ""}patched.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
