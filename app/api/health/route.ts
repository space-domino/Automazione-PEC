import { checkDb } from "@/lib/db";
import { checkRedis } from "@/lib/redis";
import { systemHealth } from "@/services/monitoring/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Shallow (default): db + redis, per load balancer / uptime check.
 * `?deep=1`: check completo (code, integrazioni, dati fermi) — solo per uso interno.
 */
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get("deep") === "1") {
    const h = await systemHealth();
    return Response.json(h, { status: h.status === "down" ? 503 : 200 });
  }

  const [db, redis] = await Promise.all([checkDb(), checkRedis()]);
  const ok = db && redis;
  return Response.json(
    {
      status: ok ? "ok" : "degraded",
      db: db ? "ok" : "down",
      redis: redis ? "ok" : "down",
      ts: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
