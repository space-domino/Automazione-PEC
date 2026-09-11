import { logger } from "@/lib/logger";
import { QUEUE_NAMES, getQueue } from "@/lib/queue";
import { sendPendingAccountSetupEmails } from "@/services/email/account-setup";
import { syncExternalSales } from "@/services/sales";
import { pushOffer, removeOffer } from "@/services/spacedomino";
import type { Job } from "bullmq";
import { createWorker } from "../lib/create-worker";

const log = logger.child({ worker: "storefront" });

interface StorefrontJobData {
  offerId?: string;
  sld?: string;
  tld?: string;
  price?: number;
}

/**
 * Coda `storefront`:
 *  - `storefront.push` / `storefront.remove`: propagano il ciclo di vita delle
 *    offerte al catalogo `products` di spacedomino.it.
 *  - `storefront.sync`: bridge vendite — legge `orders`/`order_items` dello
 *    storefront e ingerisce gli acquisti abbinati a un'offerta (M8).
 *
 * Se lo storefront non è collegato (`SPACEDOMINO_DATABASE_URL` assente) ogni job
 * è un no-op tracciato a log e "riesce" comunque.
 */
export function startStorefrontWorker() {
  return createWorker<StorefrontJobData, unknown>(
    QUEUE_NAMES.storefront,
    async (job: Job<StorefrontJobData>) => {
      if (job.name === "storefront.sync") {
        const sales = await syncExternalSales({}, { requestId: `job:${job.id}` });
        // mai far fallire il sync vendite per un problema di SendGrid
        const setupEmails = await sendPendingAccountSetupEmails().catch((err) => {
          log.warn({ err }, "poll mail post-acquisto: errore non bloccante");
          return null;
        });
        return { sales, setupEmails };
      }

      const { offerId, sld, tld, price } = job.data;
      if (!sld || !tld) throw new Error(`${job.name}: sld/tld mancanti (offer ${offerId})`);

      if (job.name === "storefront.remove") {
        return removeOffer(sld, tld);
      }
      if (job.name === "storefront.push") {
        if (price == null) throw new Error(`storefront.push senza prezzo (offer ${offerId})`);
        return pushOffer({ sld, tld, price });
      }
      throw new Error(`job storefront sconosciuto: ${job.name}`);
    },
    { concurrency: 2 },
  );
}

/** Job ripetibile: ogni 15 min riconcilia le vendite dallo storefront. */
export async function scheduleStorefrontSync(): Promise<void> {
  await getQueue(QUEUE_NAMES.storefront).add(
    "storefront.sync",
    {},
    {
      repeat: { every: 15 * 60_000 },
      jobId: "storefront.sync",
      removeOnComplete: true,
      removeOnFail: 50,
    },
  );
}
