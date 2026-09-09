import { redis } from "@/lib/redis";
import type { AvailabilityResult } from "@prisma/client";

export interface CachedAvailability {
  result: AvailabilityResult;
  provider: string;
  at: number;
}

const key = (fqdn: string) => `avail:${fqdn.toLowerCase()}`;

export async function getCachedAvailability(fqdn: string): Promise<CachedAvailability | null> {
  try {
    const raw = await redis.get(key(fqdn));
    return raw ? (JSON.parse(raw) as CachedAvailability) : null;
  } catch {
    return null;
  }
}

/** Si cache SOLO gli esiti definitivi (AVAILABLE / REGISTERED). */
export async function setCachedAvailability(
  fqdn: string,
  data: CachedAvailability,
  ttlHours: number,
): Promise<void> {
  if (ttlHours <= 0) return;
  try {
    await redis.set(key(fqdn), JSON.stringify(data), "EX", Math.round(ttlHours * 3600));
  } catch {
    // cache best-effort
  }
}
