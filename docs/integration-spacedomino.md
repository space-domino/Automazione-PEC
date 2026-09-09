# Integrazione con spacedomino.it

`spacedomino.it` è lo **storefront esistente** (Space Domino S.R.L.). La piattaforma
di automazione **non lo modifica**: gli fornisce i domini da vendere e ne legge le vendite.

## Stack di spacedomino.it (rilevato, sola lettura)

- Monorepo su VPS `<HOST_VPS>` in `/root/spacedomino`, Docker (Ubuntu 24.04).
- Client: Vite + React 19 + wouter + tRPC client.
- Server: Express + **tRPC v11** + **Drizzle ORM** + **MySQL 8** (`mysql2`), JWT (`jose`) in cookie, **Stripe v22**.
- Container: `spacedomino_app` (:3000), `spacedomino_nginx` (:80/443), `spacedomino_db` (MySQL, db `spacedomino`).

### Tabelle rilevanti (MySQL, schema Drizzle)

| Tabella | Colonne chiave | Ruolo |
|---|---|---|
| `products` | `id, name` (SLD, es. `eternaholding`), `tld` (**con il punto**, `.it`), `price` decimal, `premium` bool, `category` (`Domini Premium`/`Italia`/`Internazionale`), `createdAt`. Unique `(name, tld)`. | Catalogo domini in vendita (sezione `#domains`). Lettura pubblica: `trpc domain.listProducts`. |
| `orders` | `id, userId?, email, customerName, status` (pending/paid/processing/completed/cancelled/refunded), `totalAmount`, `orderNumber`, `paymentRef`, `paidAt`, `completedAt` | Ordini |
| `order_items` | `id, orderId, domain` (SLD), `tld` (con il punto), `price`, `years`, `status` (pending/registered/failed/transferred) | Righe ordine |
| `domains` | `userId, orderId, name` (FQDN), `status`, nameserver | Domini posseduti dagli utenti dopo l'acquisto |
| `email_tracking_events` | `recipientHash`, `recipientEncrypted`, `campaign`, `subject`, `domain`, `externalMessageId`, `openCount`, `firstOpenedAt`, `notifiedAt` | Tracciamento apertura PEC/email via pixel (già esistente) |
| `users`, `user_profiles` | profilo cliente, P.IVA/PEC/CF **cifrati AES-256-GCM** applicativi | Account clienti |

Checkout: il prezzo è **sempre riletto da `products`** lato server (`resolveCatalogCartItems`),
mai accettato dal client. Solo i prodotti a catalogo sono acquistabili.
`activatePaidOrder` (webhook/redirect Stripe) marca l'ordine `paid`, gli item `registered`,
e inserisce in `domains` per l'acquirente.

## Contratto d'integrazione

| Direzione | Meccanismo | Milestone |
|---|---|---|
| **Pubblica offerta** piattaforma → storefront | `INSERT`/`UPDATE` su `products` (name, tld, price, premium, category) nel MySQL di spacedomino, tramite un connettore dedicato (`SPACEDOMINO_DATABASE_URL`, utente MySQL con grant minimi). | M7 |
| **Ritira offerta** | `DELETE FROM products WHERE name=? AND tld=?` (o flag se lo aggiungono). | M7 |
| **Vendite** storefront → piattaforma | Job `storefront.sync` (ogni 15 min + trigger `POST /api/sales/sync`): `SELECT` su `order_items` JOIN `orders` con `status IN ('paid','completed')` → abbina per `fqdn` a un'`Offer`, avanza `Offer`→`SOLD` e `Domain`→`SOLD`, crea `Order` interno (`source=SPACEDOMINO`) con `customerData`. Idempotente su `(externalOrderNumber, domainId)`. | M8 ✅ |
| **Aperture PEC** (opzionale) | `SELECT` su `email_tracking_events` per campagna/dominio → aggiorna stato `Communication`. | M10 |
| **Import iniziale** | Legge `products` (export una tantum) → crea `Company` + `Domain` (`OFFER_PUBLISHED`) + `Offer` (`PUBLISHED`) per ognuno. | ora |

### Mappatura campi

- FQDN = `products.name` + `products.tld` (il tld ha già il punto) → es. `eternaholding` + `.it` = `eternaholding.it`
- slug piattaforma = FQDN con `.` → `-` → `eternaholding-it` (= `slugify(fqdn)`)
- `Offer.landingPageUrl` = `https://spacedomino.it/domini/<slug>`
- `Offer.price` / `Domain.sellingPrice` = `products.price`
- `products.category` → `Offer` metadata / `premium` flag

## API pubblica del catalogo (M7)

La piattaforma espone un'API di sola lettura, senza autenticazione, che restituisce
le offerte `PUBLISHED` con i loro contenuti ricchi (headline, `bodyHtml`, meta SEO) —
dati che la tabella `products` di spacedomino non contiene. Utile per landing esterne
o per arricchire lo storefront senza duplicare la logica editoriale.

| Endpoint | Descrizione |
|---|---|
| `GET /api/public/offers` | Elenco paginato. Query: `q`, `extension` (`it`/`com`/…), `minPrice`, `maxPrice`, `page`, `pageSize` (≤100). |
| `GET /api/public/offers/<slug>` | Singola offerta per slug (`eternaholding-it`). 404 se non pubblicata. |
| `OPTIONS` su entrambi | Preflight CORS. |

- **CORS**: origini in whitelist da `PUBLIC_CORS_ORIGINS` (CSV). Nessun wildcard; `Vary: Origin`.
- **Cache**: `Cache-Control: public, max-age=60, s-maxage=120`.
- **Rate-limit**: per IP (fail-open se Redis è giù).
- **Campi esposti**: `slug, fqdn, sld, extension, title, headline, bodyHtml, price, currency,
  landingPageUrl, metaTitle, metaDescription, companyName, publishedAt`. Nessun dato interno
  (prezzo d'acquisto, note, stato PEC, contatti).

## Connettore storefront (M7) — `services/spacedomino`

Feature-flag: attivo **solo** se `SPACEDOMINO_DATABASE_URL` è impostata (`features.storefront`).
Se assente, ogni operazione è un no-op tracciato a log.

- `pushOffer({sld, tld, price, premium?, category?})` → `INSERT … ON DUPLICATE KEY UPDATE`
  su `products` (colonne toccate: `name, tld, price, premium, category`). Idempotente su `UNIQUE(name, tld)`.
- `removeOffer(sld, tld)` → `DELETE FROM products WHERE name=? AND tld=?`.
- `pingStorefront()` → diagnostica connettività + `COUNT(*)` su `products`.

Euristica quando l'offerta non specifica `premium`/`category`:
`premium = price >= 499`; `category = premium ? "Domini Premium" : tld === "it" ? "Italia" : "Internazionale"`.

Il ciclo di vita `Offer` (`services/offers`) accoda i job sulla coda **`storefront`**
(`storefront.push` alla pubblicazione / cambio prezzo, `storefront.remove` a pausa/ritiro);
il worker `worker/queues/storefront.ts` li esegue.

> Se lo schema reale di `products` richiede colonne non-null aggiuntive su INSERT
> (es. `createdAt` senza default), adegua `PRODUCT_INSERT_COLS` in `services/spacedomino/index.ts`.

## Bridge vendite (M8) — `services/sales`

Il pagamento avviene **interamente sullo storefront** (Stripe di spacedomino): PEC →
link → pagina prodotto → carrello → checkout Stripe. La piattaforma **non tocca Stripe**;
rileva l'acquisto leggendo il DB dello storefront.

- `fetchCompletedSales({sinceDays,limit})` (connettore) → `SELECT` join `order_items`+`orders`
  con `orders.status IN ('paid','completed')` e `order_items.status <> 'failed'`, finestra `sinceDays`.
  Nomi tabella/colonna dallo schema Drizzle rilevato — se differiscono, unico punto da adeguare.
- `ingestExternalSale(row)` → abbina per `fqdn`; se nessuna `Offer` → `unmatched` (atteso: sono
  le vendite del catalogo proprio di spacedomino). Altrimenti avanza `Offer` e `Domain` fino a
  `SOLD` passo-passo lungo la macchina a stati, crea `Order` (`source=SPACEDOMINO`,
  `paymentStatus=SUCCEEDED`, `orderStatus=PAID`, `customerData` = email/nome/anni/paymentRef),
  `AuditLog`. Idempotente su `(externalOrderNumber, domainId)` e sul vincolo `Order.offerId`.
- `syncExternalSales()` → loop su tutte le righe; ritorna `{scanned, sold, already, unmatched, failed, soldFqdns}`.
  No-op `{skipped:"storefront-disabled"}` se `SPACEDOMINO_DATABASE_URL` assente.
- `recordManualSale({offerId|domainId|fqdn, customerEmail, amount?, orderNumber?, …})` →
  stessa logica da input operatore (`source=MANUAL`), per quando il connettore non è ancora collegato.

**Esecuzione:** job ripetibile `storefront.sync` ogni 15 min (solo se `features.storefront`);
trigger manuale `POST /api/sales/sync` (admin, rate-limited). Lettura ordini: `GET /api/sales`,
`GET /api/sales/:id`. Registrazione manuale: `POST /api/sales`.

**Schema:** `Order` esteso con `source` (`SPACEDOMINO`/`MANUAL`/`PLATFORM_STRIPE`),
`externalOrderNumber`, `externalRef`; `stripeCheckoutSessionId` ora nullable;
unique `(externalOrderNumber, domainId)`. Migrazione: `prisma migrate dev --name order_external_source`.

## Sicurezza

- Il connettore MySQL usa un utente dedicato con `SELECT` su `orders`/`order_items`/`email_tracking_events`
  e `INSERT/UPDATE/DELETE` **solo** su `products`. Niente accesso a `users`/`user_profiles`.
- Le credenziali root SSH fornite in chiaro vanno **ruotate** dopo la fase di analisi; sostituire con
  chiave SSH + utente non-root in sola lettura.
