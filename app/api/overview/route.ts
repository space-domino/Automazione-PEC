import { handler } from "@/lib/api/handler";
import { redis } from "@/lib/redis";
import { getOverview } from "@/services/catalog/overview";

export const runtime = "nodejs";

// cache 60s (sezione F.8) — best effort
export const GET = handler(
  async () => {
    try {
      const cached = await redis.get("overview:v1");
      if (cached) return new Response(cached, { headers: { "content-type": "application/json" } });
    } catch {
      // no cache
    }
    const data = await getOverview();
    const body = JSON.stringify(data);
    try {
      await redis.set("overview:v1", body, "EX", 60);
    } catch {
      // no cache
    }
    return new Response(body, { headers: { "content-type": "application/json" } });
  },
  { auth: "admin" },
);
