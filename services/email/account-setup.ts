import { db } from "@/lib/db";
import { env, features } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getSetting } from "@/lib/settings";
import { htmlToText, renderTemplate } from "@/services/pec/render";
import { fetchCompletedSales } from "@/services/spacedomino";
import { getAccountSetupTemplate } from "./templates";
import { sendEmail } from "./transport";

const log = logger.child({ svc: "email", job: "account-setup" });

export interface AccountSetupPollResult {
  scanned: number;
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Per ogni ordine pagato su spacedomino non ancora notificato: mail "completa
 * la registrazione" via SendGrid. Una sola volta per ordine (AccountSetupEmail
 * è la tabella di deduplica). Indipendente dall'abbinamento dominio->Company
 * di services/sales: qui basta che l'ordine sia pagato, il dominio comprato
 * viene letto direttamente da order_items.
 */
export async function sendPendingAccountSetupEmails(
  opts: { sinceDays?: number; limit?: number } = {},
): Promise<AccountSetupPollResult> {
  const result: AccountSetupPollResult = { scanned: 0, sent: 0, failed: 0, skipped: 0 };
  if (!features.storefront) return result;

  const rows = await fetchCompletedSales({
    sinceDays: opts.sinceDays ?? 90,
    limit: opts.limit ?? 200,
  });
  result.scanned = rows.length;
  if (rows.length === 0) return result;

  if (!features.email) {
    log.warn("SendGrid non configurato: mail post-acquisto saltate");
    result.skipped = rows.length;
    return result;
  }

  const sendgridTemplateId = await getSetting("email.account_setup_sendgrid_template_id");
  const tpl = sendgridTemplateId ? null : await getAccountSetupTemplate();
  if (!sendgridTemplateId && !tpl) {
    log.warn('nessun template SendGrid né EMAIL_BODY "account-setup": mail post-acquisto saltate');
    result.skipped = rows.length;
    return result;
  }

  for (const row of rows) {
    const already = await db.accountSetupEmail.findUnique({
      where: { externalOrderNumber: row.orderNumber },
    });
    if (already) {
      result.skipped++;
      continue;
    }
    if (!row.email || !row.sld || !row.tld) {
      result.skipped++;
      continue;
    }

    const domain = `${row.sld}${row.tld}`;
    const vars = {
      domain,
      customer_email: row.email,
      signup_url: `${env.SPACEDOMINO_BASE_URL.replace(/\/+$/, "")}/registrati?email=${encodeURIComponent(row.email)}`,
      seller_legal_name: "Space Domino S.R.L.",
      seller_contact: env.SENDGRID_FROM_EMAIL || env.PEC_FROM_ADDRESS || "",
    };

    try {
      const res = sendgridTemplateId
        ? await sendEmail({
            to: row.email,
            templateId: sendgridTemplateId,
            dynamicTemplateData: vars,
          })
        : await sendEmail({
            to: row.email,
            subject: renderTemplate(tpl!.subject, vars),
            html: renderTemplate(tpl!.bodyHtml, vars),
            text: htmlToText(renderTemplate(tpl!.bodyHtml, vars)),
          });
      await db.accountSetupEmail.create({
        data: {
          externalOrderNumber: row.orderNumber,
          recipient: row.email,
          domain,
          status: "sent",
          providerMessageId: res.messageId,
        },
      });
      result.sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.accountSetupEmail
        .create({
          data: {
            externalOrderNumber: row.orderNumber,
            recipient: row.email,
            domain,
            status: "failed",
            error: msg.slice(0, 500),
          },
        })
        .catch(() => {});
      log.warn({ orderNumber: row.orderNumber, err: msg }, "invio mail post-acquisto fallito");
      result.failed++;
    }
  }

  log.info(result, "poll mail post-acquisto completato");
  return result;
}
