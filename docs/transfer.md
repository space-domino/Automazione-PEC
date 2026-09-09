# Trasferimento e consegna del dominio (Milestone 11)

A valle della vendita (M8) il `Domain` è in `SOLD` e l'`Order` in `orderStatus=PAID`.
M11 gestisce la consegna al cliente del dominio (registrato a nostro nome).

## Macchine a stati

- **Domain** (E.2): `SOLD → TRANSFER_PENDING → TRANSFERRED` · fallimento `→ TRANSFER_FAILED → TRANSFER_PENDING` (retry).
- **Order** (E.5, nuova `orderStateConfig`): `PAID → FULFILLMENT_PENDING → TRANSFERRED → COMPLETED`.
  La colonna è `orderStatus` (non `status`): il config la rimappa per il motore generico.
  Stati protetti (no `forceTransition`): `COMPLETED`, `REFUNDED`, `CANCELLED`.

## `services/transfer/index.ts`

| Funzione | Effetto |
|---|---|
| `startTransfer(orderId, {method, notes?, authCode?})` | `Order PAID→FULFILLMENT_PENDING`, `Domain SOLD→TRANSFER_PENDING`, salva `transferStartedAt`/`transferMethod` e — se fornito — `transferAuthCodeEnc` (cifrato). |
| `setTransferAuthCode(orderId, authCode)` | Cifra e salva/sostituisce l'authcode (durante `FULFILLMENT_PENDING`/`TRANSFERRED`). |
| `completeTransfer(orderId, {notes?})` | `Domain→TRANSFERRED`, `Order→TRANSFERRED→COMPLETED`, `transferCompletedAt`. |
| `failTransfer(orderId, reason)` | `Domain→TRANSFER_FAILED`, appende la nota. L'Order resta `FULFILLMENT_PENDING`. |
| `retryTransfer(orderId)` | `Domain TRANSFER_FAILED→TRANSFER_PENDING`. |
| `revealAuthCode(orderId)` | Decifra e restituisce l'authcode **una volta**; scrive `AuditLog transfer.authcode.reveal` + log `warn`. |
| `listTransfers({stage})` | `stage`: `to_start` (PAID+SOLD) · `in_progress` · `failed` · `done`. Mai l'authcode: solo `hasAuthCode`. |
| `getTransfer(orderId)` | Dettaglio sanificato + `deliveryUrl`. |

`method` ∈ `EPP_TRANSFER` · `REGISTRAR_PUSH` · `MANUAL`.

## Codice di autorizzazione (`lib/crypto`)

AES-256-GCM con `DATA_ENCRYPTION_KEY` (base64 di 32 byte). Token: `v1.<iv>.<tag>.<ct>`.
`encryptString` / `decryptString` (autenticato: un token manomesso lancia).
Nel DB solo `transferAuthCodeEnc`; il valore in chiaro non è mai loggato né incluso nelle liste.

## Consegna al cliente — `GET /api/delivery/<token>`

Pubblica (in `PUBLIC_PREFIXES`), token HMAC firmato scope `delivery` (`{o: orderId}`, TTL 60g),
`buildDeliveryUrl(orderId)`. Pagina HTML minimale (`noindex`, `no-store`) con dominio,
istruzioni per il metodo scelto e — **solo se** `Domain` è in `TRANSFER_PENDING`/`TRANSFERRED`
e l'authcode è stato salvato — il codice in chiaro. Token non valido → 404.

## API (admin)

`GET /api/transfers` `?stage&q` · `GET /api/transfers/:id`
`POST /api/transfers/:id/{start,authcode,authcode/reveal,complete,fail,retry}`

## Non fatto (follow-up / M12)

- Invio automatico del link di consegna al cliente (email semplice, non PEC) all'avvio del trasferimento.
- Rimborso (`Order/Domain → REFUNDED`) e reset offerta (`REFUNDED → OFFER_DRAFT`).
- Alert per trasferimenti fermi da troppo tempo.
