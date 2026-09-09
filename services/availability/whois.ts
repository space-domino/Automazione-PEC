import { createConnection } from "node:net";
import type { AvailabilityResult } from "@prisma/client";

/**
 * Fallback WHOIS (porta 43) SOLO per i TLD senza RDAP o quando RDAP è ambiguo.
 * Best effort: se l'esito non è chiaro -> UNKNOWN (mai un "AVAILABLE" a caso).
 */
const WHOIS_SERVERS: Record<string, string> = {
  it: "whois.nic.it",
  com: "whois.verisign-grs.com",
  net: "whois.verisign-grs.com",
  org: "whois.pir.org",
  eu: "whois.eu",
  co: "whois.nic.co",
  info: "whois.afilias.net",
  biz: "whois.nic.biz",
};

const AVAILABLE_PATTERNS = [
  /no match/i,
  /not found/i,
  /no entries found/i,
  /no data found/i,
  /domain not found/i,
  /is available for/i,
  /^\s*status:\s*(available|free|no registrar)\s*$/im,
];

const REGISTERED_PATTERNS = [
  /creation date/i,
  /created:/i,
  /registrar:/i,
  /registrant/i,
  /status:\s*(ok|active|connect|client|server|inactive|hold)/i,
  /name server/i,
  /nserver:/i,
  /expiry date/i,
];

function whoisRaw(server: string, query: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(43, server);
    let buf = "";
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => socket.write(`${query}\r\n`));
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
    });
    socket.on("end", () => resolve(buf));
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("whois timeout"));
    });
    socket.on("error", reject);
  });
}

export interface WhoisCheck {
  supported: boolean;
  result: AvailabilityResult;
  provider: string;
  error?: string;
  durationMs: number;
}

export async function whoisCheck(fqdn: string): Promise<WhoisCheck> {
  const startedAt = Date.now();
  const tld = fqdn.toLowerCase().trim().replace(/\.$/, "").split(".").pop() ?? "";
  const server = WHOIS_SERVERS[tld];

  if (!server) {
    return {
      supported: false,
      result: "UNKNOWN",
      provider: "whois",
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    const raw = await whoisRaw(server, fqdn);
    const provider = `whois:${server}`;
    if (AVAILABLE_PATTERNS.some((re) => re.test(raw))) {
      return { supported: true, result: "AVAILABLE", provider, durationMs: Date.now() - startedAt };
    }
    if (REGISTERED_PATTERNS.some((re) => re.test(raw))) {
      return {
        supported: true,
        result: "REGISTERED",
        provider,
        durationMs: Date.now() - startedAt,
      };
    }
    return { supported: true, result: "UNKNOWN", provider, durationMs: Date.now() - startedAt };
  } catch (err) {
    return {
      supported: true,
      result: "ERROR",
      provider: `whois:${server}`,
      error: (err as Error).message.slice(0, 200),
      durationMs: Date.now() - startedAt,
    };
  }
}
