import { env, features } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { ImapFlow } from "imapflow";
import { PecNotConfiguredError } from "./errors";

/**
 * Lettura IMAP della casella PEC per raccogliere le ricevute del gestore
 * (accettazione, avvenuta/mancata consegna) — sezione H.7.
 *
 * Connessione breve, aperta e chiusa a ogni poll. Feature-flag: SMTP + IMAP
 * condividono `features.pec`, ma l'host IMAP è opzionale a parte.
 */

const log = logger.child({ svc: "pec", part: "imap" });

function imapReady(): boolean {
  return Boolean(env.PEC_IMAP_HOST && env.PEC_IMAP_USER && env.PEC_IMAP_PASS && features.pec);
}

async function connect(): Promise<ImapFlow> {
  if (!imapReady()) throw new PecNotConfiguredError("IMAP PEC");
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: env.PEC_IMAP_HOST as string,
    port: env.PEC_IMAP_PORT,
    secure: env.PEC_IMAP_PORT === 993,
    auth: { user: env.PEC_IMAP_USER as string, pass: env.PEC_IMAP_PASS as string },
    logger: false,
    emitLogs: false,
  });
  await client.connect();
  return client;
}

export interface RawMessage {
  uid: number;
  internalDate: Date;
  subject: string;
  from: string;
  source: Buffer;
}

export interface FetchResult {
  messages: RawMessage[];
  highestUid: number;
}

/**
 * Scarica i messaggi con UID > `afterUid`. Se `afterUid` è 0 usa una ricerca
 * per data (`sinceDays`) per non ingoiare l'intera casella al primo giro.
 */
export async function fetchRaw(opts: {
  afterUid: number;
  sinceDays: number;
  mailbox?: string;
  limit?: number;
}): Promise<FetchResult> {
  const mailbox = opts.mailbox ?? "INBOX";
  const limit = Math.min(500, Math.max(1, opts.limit ?? 200));
  const client = await connect();
  const messages: RawMessage[] = [];
  let highestUid = opts.afterUid;

  const lock = await client.getMailboxLock(mailbox);
  try {
    let range: string;
    if (opts.afterUid > 0) {
      range = `${opts.afterUid + 1}:*`;
    } else {
      const since = new Date(Date.now() - opts.sinceDays * 86_400_000);
      const uids = await client.search({ since }, { uid: true });
      if (!uids || uids.length === 0) {
        return { messages, highestUid };
      }
      range = uids.slice(-limit).join(",");
    }

    for await (const msg of client.fetch(
      range,
      { uid: true, source: true, envelope: true, internalDate: true },
      { uid: true },
    )) {
      // il range "X:*" può restituire l'ultimo messaggio anche se UID <= afterUid
      if (msg.uid <= opts.afterUid) continue;
      if (!msg.source) continue;
      messages.push({
        uid: msg.uid,
        internalDate: msg.internalDate ? new Date(msg.internalDate) : new Date(),
        subject: msg.envelope?.subject ?? "",
        from: msg.envelope?.from?.[0]?.address ?? "",
        source: msg.source,
      });
      if (msg.uid > highestUid) highestUid = msg.uid;
      if (messages.length >= limit) break;
    }
  } finally {
    lock.release();
  }

  await client.logout().catch(() => client.close());
  log.info({ mailbox, fetched: messages.length, highestUid }, "poll IMAP completato");
  return { messages, highestUid };
}

export interface ImapHealth {
  configured: boolean;
  ok: boolean;
  mailbox?: string;
  exists?: number;
  error?: string;
}

/** Apre la connessione, seleziona INBOX, riporta il conteggio messaggi. */
export async function pingImap(): Promise<ImapHealth> {
  if (!imapReady()) return { configured: false, ok: false, error: "pec-disabled" };
  try {
    const client = await connect();
    const mbox = await client.mailboxOpen("INBOX");
    const exists = mbox.exists;
    await client.logout().catch(() => client.close());
    return { configured: true, ok: true, mailbox: "INBOX", exists };
  } catch (err) {
    return { configured: true, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
