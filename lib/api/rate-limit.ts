import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** secondi al reset della finestra */
  retryAfter: number;
}

/**
 * Rate-limit a finestra fissa su Redis (sezione F.6).
 * Fail-open: se Redis non risponde NON blocchiamo il traffico legittimo, ma logghiamo.
 *
 * @param key     identificatore logico (es. "login:mario@x.it", "checkout:1.2.3.4")
 * @param limit   richieste massime nella finestra
 * @param windowSec ampiezza della finestra in secondi
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const redisKey = `rl:${key}`;
  try {
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, windowSec);
      return { ok: true, remaining: limit - 1, retryAfter: windowSec };
    }
    const ttl = await redis.ttl(redisKey);
    return {
      ok: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfter: ttl > 0 ? ttl : windowSec,
    };
  } catch (err) {
    logger.warn({ err, key }, "rate-limit: Redis non disponibile, fail-open");
    return { ok: true, remaining: limit, retryAfter: 0 };
  }
}
