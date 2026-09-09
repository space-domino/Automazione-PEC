import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";
import type { AvailabilityResult } from "@prisma/client";

/**
 * Client RDAP (sezione B.5 / D — Fase 5). Fonte primaria, deterministica, gratuita.
 * TLD -> endpoint RDAP dal bootstrap IANA (cache Redis 7g), con mappa hardcoded
 * ad alta confidenza come degrado. NESSUN endpoint inventato.
 */
const BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const BOOTSTRAP_CACHE_KEY = "rdap:bootstrap";
const BOOTSTRAP_TTL_SEC = 7 * 24 * 3600;
const RDAP_TIMEOUT_MS = 10_000;
const HOST_MIN_INTERVAL_MS = 300;
const MAX_ATTEMPTS = 3;

// Fallback usato solo se il bootstrap IANA non è raggiungibile.
// Solo endpoint VERIFICATI come funzionanti. NB: `.it` (Registro.it) NON pubblica
// un RDAP pubblico e non è nel bootstrap IANA -> per `.it` si usa WHOIS (whois.nic.it).
const HARDCODED_BASES: Record<string, string> = {
  com: "https://rdap.verisign.com/com/v1/",
  net: "https://rdap.verisign.com/net/v1/",
  org: "https://rdap.publicinterestregistry.org/rdap/",
};

interface BootstrapFile {
  services?: Array<[string[], string[]]>;
}

let memBootstrap: Record<string, string> | null = null;
const lastHostCallAt = new Map<string, number>();

function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return fetch(url, {
    signal: ac.signal,
    redirect: "follow",
    headers: {
      accept: "application/rdap+json, application/json",
      "user-agent": "domain-reselling-platform/0.1 (RDAP availability check)",
    },
  }).finally(() => clearTimeout(t));
}

export function tldOf(fqdn: string): string {
  const parts = fqdn.toLowerCase().trim().replace(/\.$/, "").split(".");
  return parts[parts.length - 1] ?? "";
}

async function loadBootstrap(): Promise<Record<string, string>> {
  if (memBootstrap) return memBootstrap;

  try {
    const cached = await redis.get(BOOTSTRAP_CACHE_KEY);
    if (cached) {
      memBootstrap = JSON.parse(cached) as Record<string, string>;
      return memBootstrap;
    }
  } catch {
    // redis non disponibile: si prosegue col fetch
  }

  try {
    const res = await fetchWithTimeout(BOOTSTRAP_URL, RDAP_TIMEOUT_MS);
    if (res.ok) {
      const data = (await res.json()) as BootstrapFile;
      const map: Record<string, string> = {};
      for (const [tlds, urls] of data.services ?? []) {
        const url = urls.find((u) => u.startsWith("https://")) ?? urls[0];
        if (!url) continue;
        const base = url.endsWith("/") ? url : `${url}/`;
        for (const t of tlds) map[t.toLowerCase()] = base;
      }
      memBootstrap = { ...HARDCODED_BASES, ...map };
      try {
        await redis.set(BOOTSTRAP_CACHE_KEY, JSON.stringify(memBootstrap), "EX", BOOTSTRAP_TTL_SEC);
      } catch {
        // ok: cache non scritta
      }
      return memBootstrap;
    }
    logger.warn({ status: res.status }, "rdap: bootstrap IANA non ok, uso mappa hardcoded");
  } catch (err) {
    logger.warn({ err }, "rdap: bootstrap IANA non raggiungibile, uso mappa hardcoded");
  }

  memBootstrap = { ...HARDCODED_BASES };
  return memBootstrap;
}

async function throttleHost(host: string): Promise<void> {
  const wait = HOST_MIN_INTERVAL_MS - (Date.now() - (lastHostCallAt.get(host) ?? 0));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHostCallAt.set(host, Date.now());
}

export interface RdapCheck {
  /** false = nessun endpoint RDAP noto per quel TLD (-> fallback WHOIS) */
  supported: boolean;
  result: AvailabilityResult;
  provider: string;
  statusCode?: number;
  meta?: Record<string, unknown>;
  error?: string;
  durationMs: number;
}

export async function rdapCheck(fqdn: string): Promise<RdapCheck> {
  const startedAt = Date.now();
  const tld = tldOf(fqdn);
  const bootstrap = await loadBootstrap();
  const base = bootstrap[tld];

  if (!base) {
    return {
      supported: false,
      result: "UNKNOWN",
      provider: "rdap",
      durationMs: Date.now() - startedAt,
    };
  }

  const host = new URL(base).host;
  const url = `${base}domain/${encodeURIComponent(fqdn)}`;
  const provider = `rdap:${host}`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await throttleHost(host);
    try {
      const res = await fetchWithTimeout(url, RDAP_TIMEOUT_MS);

      if (res.status === 404) {
        return {
          supported: true,
          result: "AVAILABLE",
          provider,
          statusCode: 404,
          durationMs: Date.now() - startedAt,
        };
      }

      if (res.status === 200) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        return {
          supported: true,
          result: "REGISTERED",
          provider,
          statusCode: 200,
          meta: { status: body.status, events: body.events, ldhName: body.ldhName },
          durationMs: Date.now() - startedAt,
        };
      }

      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after")) || attempt * 1.5;
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, Math.min(retryAfter, 10) * 1000));
          continue;
        }
        return {
          supported: true,
          result: "UNKNOWN",
          provider,
          statusCode: res.status,
          error: `HTTP ${res.status} (rate limit / server)`,
          durationMs: Date.now() - startedAt,
        };
      }

      // 400 / 403 / risposte inattese: non concludiamo nulla
      return {
        supported: true,
        result: "UNKNOWN",
        provider,
        statusCode: res.status,
        error: `HTTP ${res.status}`,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, attempt * 400));
        continue;
      }
      return {
        supported: true,
        result: "ERROR",
        provider,
        error: (err as Error).message.slice(0, 200),
        durationMs: Date.now() - startedAt,
      };
    }
  }

  return { supported: true, result: "UNKNOWN", provider, durationMs: Date.now() - startedAt };
}

/** Per i test: resetta le cache in-memory. */
export function _resetRdapCaches(): void {
  memBootstrap = null;
  lastHostCallAt.clear();
}
