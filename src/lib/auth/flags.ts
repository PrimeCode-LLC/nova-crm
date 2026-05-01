/** No Firebase imports — safe for Edge middleware. */
export function isAuthDisabled(): boolean {
  return (
    process.env.DISABLE_AUTH === "true" ||
    process.env.NEXT_PUBLIC_AUTH_DISABLED === "true"
  );
}
