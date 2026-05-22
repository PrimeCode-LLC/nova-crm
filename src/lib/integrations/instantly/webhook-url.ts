/** Public URL for Instantly to POST webhook events (includes org id query param). */
export function buildInstantlyWebhookUrl(organizationId: string): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim()?.replace(/\/$/, "");
  const vercelHost = process.env.VERCEL_URL?.trim();
  const origin =
    fromEnv ||
    (vercelHost ? `https://${vercelHost}` : "http://localhost:3000");
  const params = new URLSearchParams({ organizationId });
  return `${origin}/api/integrations/webhook/instantly?${params.toString()}`;
}
