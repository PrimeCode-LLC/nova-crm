import { spawn } from "node:child_process";
import process from "node:process";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("This launcher must run inside Firebase emulators:exec.");
}

const firebaseConfig = process.env.FIREBASE_CONFIG
  ? JSON.parse(process.env.FIREBASE_CONFIG)
  : {};
const projectId = process.env.GCLOUD_PROJECT ?? firebaseConfig.projectId;
const app = initializeApp({ projectId: projectId || "novacrm-41ef8" });
const db = getFirestore(app);

await db.collection("users").doc("dev").set({
  organizationId: "dev-org",
  email: "dev@local",
  displayName: "Local import tester",
  roleId: "manager",
  orgRole: "owner",
  status: "active",
  isSuperAdmin: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

console.log(
  `Local import environment ready (Firestore ${process.env.FIRESTORE_EMULATOR_HOST}).`,
);

const isWindows = process.platform === "win32";
const command = isWindows ? process.env.ComSpec ?? "cmd.exe" : "npm";
const args = isWindows ? ["/d", "/s", "/c", "npm run dev"] : ["run", "dev"];
const child = spawn(command, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    DISABLE_AUTH: "true",
    NEXT_PUBLIC_AUTH_DISABLED: "true",
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
