import Redis from "ioredis";
import { env, isProd } from "./env";

/**
 * Client Redis dell'APP (cache + rate-limit).
 * Il worker BullMQ (M2) userà una PROPRIA connessione dedicata.
 *
 * maxRetriesPerRequest: 2 -> l'health check e il rate-limit falliscono in fretta
 * invece di restare appesi se Redis è giù.
 */
const globalForRedis = globalThis as unknown as { redis?: Redis };

export const redis =
  globalForRedis.redis ??
  new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    connectTimeout: 3000,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });

if (!isProd) globalForRedis.redis = redis;

/** Ping usato da /api/health. */
export async function checkRedis(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}
