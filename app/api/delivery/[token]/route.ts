import { escapeHtml } from "@/services/pec/render";
import { type DeliveryView, resolveDelivery } from "@/services/transfer";

export const runtime = "nodejs";

/**
 * Pagina di consegna al cliente (sezione K / M11). Pubblica, senza login,
 * protetta da token HMAC firmato (scope "delivery"). Mostra istruzioni +
 * codice di autorizzazione quando il trasferimento è in corso.
 */

function shell(title: string, inner: string, status: number): Response {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<div style="font:16px/1.6 system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1.25rem;color:#1a1a1a">
${inner}
</div>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
      "cache-control": "no-store",
    },
  });
}

function render(v: DeliveryView): string {
  const done = v.domainStatus === "TRANSFERRED";
  const parts = [
    `<h1 style="font-size:1.4rem;margin-bottom:.25rem">${escapeHtml(v.domain)}</h1>`,
    `<p style="color:#555;margin-top:0">${done ? "Trasferimento completato." : "Il dominio è tuo — ecco come completarne il trasferimento."}</p>`,
    `<p>${escapeHtml(v.instructions)}</p>`,
  ];
  if (v.authCode) {
    parts.push(
      `<p style="margin-bottom:.35rem"><strong>Codice di autorizzazione</strong></p>`,
      `<pre style="background:#f4f4f5;border:1px solid #e4e4e7;border-radius:8px;padding:.9rem 1rem;font-size:1rem;user-select:all;overflow-x:auto">${escapeHtml(v.authCode)}</pre>`,
      `<p style="font-size:.85rem;color:#666">Non condividere questo codice con nessuno oltre al tuo registrar.</p>`,
    );
  }
  parts.push(
    `<hr style="margin:1.5rem 0;border:none;border-top:1px solid #e4e4e7">`,
    `<p style="font-size:.85rem;color:#888">Per assistenza rispondi alla PEC che hai ricevuto.</p>`,
  );
  return parts.join("\n");
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  const view = await resolveDelivery(token);
  if (!view) {
    return shell(
      "Link non valido",
      '<h1 style="font-size:1.25rem">Link non valido</h1><p>Questo link di consegna non è valido o è scaduto.</p>',
      404,
    );
  }
  return shell(`Consegna — ${view.domain}`, render(view), 200);
}
