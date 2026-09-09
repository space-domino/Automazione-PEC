import { handler } from "@/lib/api/handler";
import { redis } from "@/lib/redis";
import { getDashboard } from "@/services/analytics";

export const runtime = "nodejs";

export const GET = handler(
  async () => {
    try {
      const cached = await redis.get("analytics:summary:v1");
      if (cached) return new Response(cached, { headers: { "content-type": "application/json" } });
    } catch {
      // niente cache
    }
    const body = JSON.stringify(await getDashboard());
    try {
      await redis.set("analytics:summary:v1", body, "EX", 60);
    } catch {
      // niente cache
    }
    return new Response(body, { headers: { "content-type": "application/json" } });
  },
  { auth: "admin" },
);
