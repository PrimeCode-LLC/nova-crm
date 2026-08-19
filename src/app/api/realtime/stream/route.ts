import { requireTenantSession } from "@/lib/auth/server";
import { getRedis } from "@/lib/cache/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await requireTenantSession();
  const url = new URL(req.url);
  const channel = url.searchParams.get("channel") ?? "notifications";
  const orgId = session.organizationId;
  const uid = session.uid;
  const topic = `realtime:org:${orgId}:${channel}:${uid}`;

  const redis = await getRedis();
  if (!redis) {
    return new Response("Redis not configured", { status: 503 });
  }

  const subscriber = redis.duplicate();
  await subscriber.connect();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(": connected\n\n"));

      await subscriber.subscribe(topic, (message) => {
        controller.enqueue(encoder.encode(`data: ${message}\n\n`));
      });

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 30_000);

      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        void subscriber.unsubscribe(topic);
        void subscriber.quit();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
