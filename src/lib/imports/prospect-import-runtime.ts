export function getUnsafeLocalImportError(): string | null {
  const isLocalDevelopment = process.env.NODE_ENV !== "production";
  const usesFirestoreEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  const explicitlyAllowsLiveFirestore =
    process.env.ALLOW_LIVE_IMPORTS_IN_DEVELOPMENT === "true";

  if (
    isLocalDevelopment &&
    !usesFirestoreEmulator &&
    !explicitlyAllowsLiveFirestore
  ) {
    return "Imports are disabled against live Firestore during local development. Stop this server and run `npm run dev:import-local` to use the isolated Firestore and Functions emulators.";
  }
  return null;
}
