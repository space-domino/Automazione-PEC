# PEC — posta certificata (Milestone 9)

Trasporto e ricezione della PEC verso le aziende target. L'**approvazione** e
l'**invio** vivono in M10; qui c'è l'infrastruttura + la composizione della bozza.

## Feature-flag

`features.pec` = `PEC_SMTP_HOST && PEC_SMTP_USER && PEC_SMTP_PASS`.
Senza queste variabili:
- `composePecDraft` / `previewPec` funzionano comunque (sono deterministici, non toccano la rete);
- `sendPec` lancia `PecNotConfiguredError`;
- `pollReceipts` è un no-op (`{skipped:"pec-disabled"}`);
- il worker non pianifica il job `pec.receipts.poll`.

L'IMAP richiede in più `PEC_IMAP_HOST/USER/PASS`.

## Componenti (`services/pec/`)

| File | Ruolo |
|---|---|
| `transport.ts` | `sendPec()` via nodemailer (SMTP 465 TLS implicito / 587 STARTTLS). `verifyTransport()` per diagnostica. Il `Message-ID` lo genera il transporter → va salvato in `Communication.providerMessageId`. |
| `imap.ts` | `fetchRaw({afterUid, sinceDays})` via imapflow: connessione breve, cursore per UID. `pingImap()`. |
| `render.ts` | `renderTemplate("{{var}}" / "{{{raw}}}")` con escaping HTML, `htmlToText()`. Chiavi piatte come nei template del seed. |
| `compose.ts` | `composePecDraft(offerId, opts)` → rende i `MessageTemplate` attivi (`PEC_SUBJECT` + `PEC_BODY`), controlla `SuppressionEntry`, crea `Communication` in `DRAFT`, porta il `Domain` `OFFER_PUBLISHED → PEC_DRAFT`. Rigenera in place se esiste già una bozza. `previewPec()` non persiste. |
| `receipts.ts` | `classifyReceipt(raw)` → tipo dal `daticert.xml` (`<postacert tipo="…">` + `<msgid>`), fallback header `X-Ricevuta` / `X-Riferimento-Message-ID`. `ingestReceipt()` abbina per `providerMessageId`, salva `PecReceipt` (idempotente), avanza `Communication.status`. `pollReceipts()` = poll IMAP → classifica → archivia + aggiorna cursore UID. |

## Macchina a stati `Communication` (E.4)

`DRAFT → APPROVED → QUEUED → SENDING → SENT → {ACCEPTED → DELIVERED | FAILED | BOUNCED}`
`FAILED/BOUNCED/CANCELLED → DRAFT` (ripresa). Le ricevute mappano:
ACCEPTANCE→`ACCEPTED`, DELIVERY→`DELIVERED`, NON_DELIVERY/NON_ACCEPTANCE/ERROR→`FAILED`.

## Coda / job

`pec.receipts.poll` — ripetibile ogni 5 min (`worker/queues/pec.ts`), solo se `features.pec`.
Trigger manuale: `POST /api/pec/poll-receipts` (admin).

## API

| Endpoint | Auth | Uso |
|---|---|---|
| `POST /api/offers/:id/pec` | admin | crea/rigenera la bozza (`{templateName?, bodyHtmlOverride?, preview?}`) |
| `GET /api/offers/:id/pec` | admin | anteprima renderizzata |
| `POST /api/communications/:id/polish` | admin | rifinitura AI del corpo bozza (`{tone?, instructions?}`); richiede `features.ai` |
| `POST /api/communications/:id/approve` | admin | `DRAFT → APPROVED`, `Domain PEC_DRAFT → PEC_APPROVED`; ricontrolla la soppressione |
| `POST /api/communications/:id/send` `?sync=1` | admin | default: accoda `pec.send` (202). `?sync=1`: invia in linea e restituisce l'esito |
| `POST /api/communications/:id/cancel` | admin | `→ CANCELLED` (se non ancora inviata), `Domain → OFFER_PUBLISHED` |
| `GET /api/communications` `?status&companyId&offerId&q` | admin | elenco |
| `GET /api/communications/:id` | admin | dettaglio + ricevute |
| `GET /api/pec/health` | admin | login SMTP + apertura IMAP |
| `POST /api/pec/poll-receipts` | admin | poll ricevute on-demand |
| `GET /api/opt-out?t=<token>` | pubblica | disiscrizione (token HMAC scope `optout`), crea `SuppressionEntry` COMPANY + PEC_ADDRESS |

## Invio (M10) — `services/pec/send.ts`

`approvePec` → `sendApprovedPec` (diretto o via job `pec.send`, retry x3 backoff 30s).
`sendApprovedPec` (`APPROVED|QUEUED|FAILED → SENT`):
1. idempotente: se già `SENT/ACCEPTED/DELIVERED` → `{status:"already"}`;
2. **ricontrollo soppressione** (l'azienda può aver fatto opt-out dopo l'approvazione) → `forceTransition` a `CANCELLED` + `Domain → OFFER_PUBLISHED`, `{status:"suppressed"}`, nessun invio;
3. **rate-limit** `pec.max_per_hour` (Setting, default 20) su Redis, fail-open → `429` con `Retry-After`;
4. `APPROVED→QUEUED→SENDING`, `sendPec()`, poi `SENDING→SENT` (salva `sentAt` + `providerMessageId`) e `Domain PEC_APPROVED → PEC_SENT`;
5. errore SMTP → `SENDING→FAILED` (`lastError`, `retryCount++`), rilancia (il job ritenta).

`providerMessageId` = Message-ID assegnato dal transporter: è la chiave con cui il poll ricevute (M9) riabbina accettazione/consegna.

## Rifinitura AI (M10) — `services/pec/proposal.ts` + `prompts/pec-proposal-v1`

`polishPec(id, {tone?, instructions?})` — solo su bozza `DRAFT`. Chiama `improveProposalCopy`
(gateway AI, `callType=TEXT_IMPROVEMENT`, budget guard + validazione Zod + 1 retry + `AiUsage`).
Salvaguardia: se l'AI perde il link `/api/opt-out`, viene riappeso dal testo originale.

## Token opt-out

`lib/tokens.ts` — HMAC-SHA256 con `TOKEN_SIGNING_KEY`, formato `<b64(payload)>.<b64(sig)>`,
scope + `exp` opzionale. Non è cifratura: nel payload solo id + scopo.
