# Automazione PEC — Domain Reselling Platform

Piattaforma proprietaria che **automatizza il business B2B di rivendita domini** di Space Domino,
integrata con lo storefront esistente **[spacedomino.it](https://spacedomino.it)** (che **non viene mai modificato**: la piattaforma gli scrive solo il catalogo e ne legge le vendite).

> Pipeline completa: **CSV aziende → analisi AI → generazione domini → verifica disponibilità →
> acquisto manuale → offerta + pubblicazione sul catalogo → PEC personalizzata (bozza → rifinitura AI →
> approvazione → invio → ricevute) → vendita rilevata dallo storefront → trasferimento dominio +
> consegna al cliente → analytics, monitoraggio, backup.**

---

## Indice

1. [Come funziona](#come-funziona)
2. [Architettura & stack](#architettura--stack)
3. [Struttura del repository](#struttura-del-repository)
4. [Avvio rapido in locale (sviluppo)](#avvio-rapido-in-locale-sviluppo)
5. [Come si usa (passo passo)](#come-si-usa-passo-passo)
6. [API principali](#api-principali)
7. [Configurare i servizi esterni](#configurare-i-servizi-esterni)
8. [Deploy su un secondo PC (uso locale, con Docker)](#deploy-su-un-secondo-pc-uso-locale-con-docker)
9. [Raggiungere la piattaforma da altri dispositivi](#raggiungere-la-piattaforma-da-altri-dispositivi)
10. [Manutenzione](#manutenzione)
11. [Sicurezza](#sicurezza)
12. [Stato del progetto](#stato-del-progetto)

---

## Come funziona

**Principio guida:** l'AI serve **solo** per interpretare i nomi delle aziende, generare/classificare i
domini candidati, dare un punteggio di confidenza e migliorare il testo commerciale. **Tutto il resto è
deterministico** (import, normalizzazione, disponibilità, prezzi, stati, pagamenti, invio PEC, log, auth).

```
CSV aziende italiane
   │  import + normalizzazione (encoding, forma societaria, provincia, dedupe)
   ▼
Analisi AI del nome commerciale ──► 3–5 domini candidati per azienda
   │  ranking deterministico (pesi configurabili)
   ▼
Verifica disponibilità   RDAP (.com/.net/.org)  ·  WHOIS :43 (.it)      ← MAI l'AI
   ▼
ACQUISTO MANUALE dell'operatore ──► "purchased" (prezzo, registrar)
   ▼
Offerta pubblicata ──► scrive la tabella `products` di spacedomino.it
   ▼
PEC personalizzata:  bozza da template → [rifinitura AI] → APPROVAZIONE MANUALE
                     → invio SMTP → ricevute IMAP (accettazione / consegna)
   ▼
Il cliente clicca il link nella PEC → pagina prodotto su spacedomino → paga con lo Stripe di spacedomino
   ▼
La piattaforma RILEVA la vendita leggendo `orders` / `order_items` di spacedomino  (non tocca mai Stripe)
   ▼
Trasferimento dominio  SOLD → TRANSFER_PENDING → TRANSFERRED
   │  authcode EPP cifrato a riposo · pagina di consegna firmata al cliente
   ▼
Ordine COMPLETED ──► analytics · monitoraggio · alert · backup
```

Ogni cambiamento di stato è **atomico** e lascia una riga in `AuditLog` + `StateTransition`
(chi, cosa, quando, prima/dopo).

---

## Architettura & stack

| Livello | Tecnologia |
|---|---|
| Dashboard + API | **Next.js 15** (App Router) + TypeScript strict — 59 route sotto `app/api/*` |
| Worker / job | processo Node separato + **BullMQ** + **Redis** — code: `import · discovery · availability · storefront · pec · monitoring` |
| Database | **PostgreSQL 16** + **Prisma 6** (23 modelli) |
| Auth | **Auth.js v5** (Credentials + argon2id, sessione JWT 8h), rate-limit anti-brute-force |
| AI | `services/ai-gateway` isola ogni chiamata — Claude Haiku 4.5 (discovery) + Sonnet 5 (ranking/copy), structured output + validazione Zod + budget giornaliero |
| Disponibilità | RDAP (bootstrap IANA in cache) + WHOIS TCP :43 per `.it` |
| PEC | `nodemailer` (SMTP) + `imapflow` + `mailparser` (ricevute `daticert.xml`) |
| Cifratura | `lib/crypto` AES-256-GCM (authcode) · `lib/tokens` HMAC-SHA256 (link firmati) · `lib/s3` SigV4 (backup) |
| Reverse proxy | **Caddy** (TLS automatico) |
| Automazioni esterne | **n8n** (solo instradamento notifiche, opzionale) |
| Deploy | Docker Compose (un solo host) |
| Qualità | Biome (lint+format), Vitest (**160 test**), Playwright |

---

## Struttura del repository

```
app/                Next.js App Router — pagine (dashboard) + API (app/api/**)
worker/             processo worker + code BullMQ (worker/queues/**)
services/           logica di dominio, una cartella per area:
  ai-gateway/         gateway AI + budget + usage
  ingestion/          import CSV → normalizzazione → dedupe
  company-registry/   normalizzazione ragione sociale / provincia / P.IVA
  domain-discovery/   generazione candidati (AI) + post-processing deterministico
  availability/        RDAP + WHOIS
  state-machine/       motore transizioni generico + config per entità
  purchase/            registrazione acquisto manuale
  offers/              ciclo di vita offerta
  spacedomino/         connettore MySQL storefront (feature-flag)
  pec/                 transport SMTP/IMAP, compose, invio, ricevute, opt-out
  sales/               bridge vendite (lettura ordini storefront)
  transfer/            trasferimento dominio + consegna cliente
  analytics/           dashboard / funnel / serie temporali
  monitoring/          health checks + alert/notifiche
prompts/             prompt AI versionati (prompt.md + meta.json + schema.ts)
db/                  schema.prisma, seed, hardening.sql
lib/                 env, db, redis, queue, crypto, tokens, s3, auth, api helpers
scripts/             CLI: create-user, import-spacedomino-catalog, backup
docs/                integration-spacedomino.md · pec.md · transfer.md · ops.md
tests/unit/          test Vitest (27 file)
Dockerfile.web · Dockerfile.worker · docker-compose.yml · docker-compose.dev.yml · Caddyfile
```

---

## Avvio rapido in locale (sviluppo)

Serve per lavorare sul codice sulla macchina di sviluppo. Per usarlo "come applicazione"
su un altro PC vai alla sezione [Deploy su un secondo PC](#deploy-su-un-secondo-pc-uso-locale-con-docker).

### Prerequisiti

- **Node.js 22 LTS** (`node -v` → `v22.x`)
- **Docker Desktop** (fornisce Postgres e Redis)
- Git

### Passi

```bash
# 1. clona
git clone https://github.com/space-domino/Automazione-PEC.git
cd Automazione-PEC

# 2. dipendenze
npm install

# 3. file di ambiente
cp .env.example .env
```

Apri `.env` e genera i **3 segreti obbligatori** (uno per riga), poi incollali:

```bash
# genera 3 valori (Linux/macOS/Git-Bash):
openssl rand -base64 32   # -> AUTH_SECRET
openssl rand -base64 32   # -> DATA_ENCRYPTION_KEY
openssl rand -base64 32   # -> TOKEN_SIGNING_KEY

# oppure con Node (funziona ovunque):
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Lascia `DATABASE_URL` e `REDIS_URL` con i valori di default (`localhost:5432` / `localhost:6379`).
Tutti gli altri campi (AI, PEC, storefront, backup…) possono restare **vuoti**: la piattaforma
parte lo stesso e quelle funzioni diventano no-op finché non le configuri.

```bash
# 4. avvia Postgres + Redis
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis

# 5. crea lo schema del database
npx prisma migrate dev --name init      # oppure, più veloce:  npx prisma db push
npx prisma generate

# 6. dati iniziali (template PEC, impostazioni)
npm run db:seed

# 7. crea l'utente amministratore della dashboard
npm run create-user -- --email tu@esempio.it --name "Tuo Nome" --password "unaPasswordLunga"

# 8. avvia i due processi (in due terminali)
npm run dev            # dashboard  -> http://localhost:3000
npm run worker:dev     # worker (code + job periodici)
```

Verifica: `curl http://localhost:3000/api/health` → `{"status":"ok","db":"ok","redis":"ok"}`.

> **Nota porte**: se la 5432 o la 6379 sono già occupate da un altro progetto, crea un file
> `docker-compose.local.yml` con un mapping di porta diverso (es. `"127.0.0.1:5433:5432"`),
> aggiungilo ai comandi `-f docker-compose.local.yml` e cambia la porta in `DATABASE_URL`.

---

## Come si usa (passo passo)

1. Apri **http://localhost:3000** → sei rimandato a `/login`. Accedi con l'utente creato al passo 7.
2. **Dashboard** (`/dashboard`) — KPI e grafici della pipeline.
3. **Import** (`/import`):
   - carica un CSV di aziende (separatore `,` o `;`, con o senza intestazione, qualsiasi encoding comune);
   - la piattaforma rileva encoding/delimitatore e **propone la mappatura delle colonne**
     (ragione sociale, P.IVA, PEC, provincia…);
   - conferma → il worker importa e **normalizza** (`ALFA COSTRUZIONI S.R.L.` → `Alfa Costruzioni`,
     `MI` → `Milano`, dedup automatico).
4. **Companies** (`/companies`) e **Domains** (`/domains`) — dalla scheda azienda avvii la
   *discovery* (richiede una chiave AI, vedi sotto); dalla scheda dominio lanci la
   *verifica disponibilità* (RDAP/WHOIS, non richiede chiavi).
5. **Acquisto**: quando un dominio è `AVAILABLE`, lo compri **fuori dalla piattaforma** dal tuo
   registrar, poi lo segni come *acquistato* (prezzo, registrar).
6. **Offerta**: crei l'offerta (prezzo di vendita), la **pubblichi** → viene scritta nel catalogo
   `products` di spacedomino (se il connettore è configurato) con URL landing
   `https://spacedomino.it/domini/<slug>`.
7. **PEC**: componi la bozza (`POST /api/offers/:id/pec`), eventualmente la **rifinisci con l'AI**
   (`POST /api/communications/:id/polish`), la **approvi** (`/approve`) e la **invii** (`/send`).
   Le ricevute del gestore PEC vengono raccolte automaticamente via IMAP.
8. **Vendita**: il cliente compra su spacedomino; il job `storefront.sync` (ogni 15 min) o
   `POST /api/sales/sync` rileva l'ordine e porta dominio e offerta a `SOLD`. In assenza di
   connettore puoi registrare la vendita a mano con `POST /api/sales`.
9. **Trasferimento**: `POST /api/transfers/:id/start` (metodo + authcode EPP, salvato **cifrato**),
   poi `/complete`. Il cliente riceve un **link di consegna firmato** (`/api/delivery/<token>`) con
   le istruzioni e il codice di autorizzazione.
10. **Monitoraggio**: `/api/monitoring` (stato sistema), `/api/notifications` (alert).

> Le sezioni 6–10 sono al momento **solo API** (nessuna interfaccia grafica dedicata): si usano
> da browser dopo il login, con `curl`, o da un client come Postman/Insomnia.

---

## API principali

Tutte richiedono login come `ADMIN` tranne dove indicato **(pubblica)**.

| Ambito | Endpoint |
|---|---|
| Salute | `GET /api/health` *(pubblica)* · `GET /api/health?deep=1` · `GET /api/monitoring` |
| Import | `POST /api/import` · `GET/POST /api/import/:id` · `POST /api/import/:id/confirm` |
| Domini | `POST /api/domains/:id/availability-check` · `/mark-purchased` · `/block` · `/discard` |
| Offerte | `GET/POST /api/offers` · `POST /api/offers/:id/{publish,pause,withdraw,revive}` |
| Catalogo pubblico | `GET /api/public/offers` · `GET /api/public/offers/:slug` *(pubbliche, CORS)* |
| PEC | `POST /api/offers/:id/pec` · `POST /api/communications/:id/{polish,approve,send,cancel}` · `GET /api/communications` |
| Ricevute PEC | `POST /api/pec/poll-receipts` · `GET /api/pec/health` |
| Opt-out | `GET /api/opt-out?t=<token>` *(pubblica)* |
| Vendite | `GET/POST /api/sales` · `POST /api/sales/sync` · `GET /api/sales/:id` |
| Trasferimenti | `GET /api/transfers` · `POST /api/transfers/:id/{start,authcode,authcode/reveal,complete,fail,retry}` |
| Consegna | `GET /api/delivery/<token>` *(pubblica, token firmato)* |
| Analytics | `GET /api/analytics/summary` · `GET /api/analytics/funnel` · `GET /api/overview` |
| Notifiche | `GET /api/notifications` · `POST /api/notifications/:id/read` · `POST /api/notifications/read-all` |

---

## Configurare i servizi esterni

Tutti opzionali. Aggiungi le variabili in `.env` e riavvia (`npm run dev` / `docker compose up -d`).

| Funzione | Variabili | Senza configurazione |
|---|---|---|
| **AI** (discovery, ranking, rifinitura copy) | `ANTHROPIC_API_KEY` | endpoint AI rispondono `AI_DISABLED` |
| **PEC** (invio + ricevute) | `PEC_SMTP_HOST/PORT/USER/PASS`, `PEC_IMAP_HOST/PORT/USER/PASS`, `PEC_FROM_ADDRESS` | bozze OK; invio/poll no-op |
| **Storefront** (push catalogo + sync vendite) | `SPACEDOMINO_DATABASE_URL` (utente MySQL dedicato, grant minimi) | connettore no-op tracciato a log |
| **Backup off-site** | `BACKUP_S3_ENDPOINT/REGION/KEY/SECRET/BUCKET` | `npm run backup` avvisa e non fa nulla |
| **Alert via n8n** | `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_TOKEN` | gli alert restano solo come `Notification` interne |

Dettagli: `docs/integration-spacedomino.md`, `docs/pec.md`, `docs/transfer.md`, `docs/ops.md`.

---

## Deploy su un secondo PC (uso locale, con Docker)

Obiettivo: far girare la piattaforma **come applicazione** su un secondo computer (Windows, macOS o
Linux), pronta all'uso e riavviabile da sola. Tutto gira in Docker: sul secondo PC serve **solo Docker**,
non Node.

### 1. Prerequisiti sul secondo PC

- **Docker Desktop** (Windows/macOS) o **Docker Engine + Compose** (Linux) — installato e avviato.
- Git (per clonare) — in alternativa scarica lo ZIP del repo.

### 2. Prendi il codice

```bash
git clone https://github.com/space-domino/Automazione-PEC.git
cd Automazione-PEC
```

### 3. Crea il file `.env`

```bash
cp .env.example .env
```

Modifica `.env` così (i campi **obbligatori** sono in grassetto):

```dotenv
NODE_ENV=production

# --- indirizzo con cui APRIRAI la dashboard (vedi sezione successiva) ---
# se accedi solo da QUESTO pc:            http://localhost:3000
# se accedi da altri dispositivi in LAN: http://IP-DEL-SECONDO-PC:3000
AUTH_URL=http://localhost:3000
APP_BASE_URL=http://localhost:3000
PUBLIC_BASE_URL=http://localhost:3000

# --- database (dentro Docker l'host è "postgres") ---
POSTGRES_USER=app
POSTGRES_PASSWORD=scegli-una-password-robusta
POSTGRES_DB=app
DATABASE_URL=postgresql://app:scegli-una-password-robusta@postgres:5432/app?schema=public
REDIS_URL=redis://redis:6379

# --- 3 segreti: genera con  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" ---
AUTH_SECRET=...44-caratteri-base64...
DATA_ENCRYPTION_KEY=...44-caratteri-base64...
TOKEN_SIGNING_KEY=...32+ caratteri...

# --- n8n richiede una password anche se non lo usi ---
N8N_BASIC_AUTH_PASSWORD=una-password-qualsiasi

UPLOADS_DIR=/app/data/uploads
```

> ⚠️ **`DATABASE_URL` e `REDIS_URL` usano gli hostname `postgres` e `redis`** (i nomi dei
> container), non `localhost`, perché `web` e `worker` girano dentro Docker.
> `AUTH_URL` invece deve combaciare con l'URL che digiti nel browser.

### 4. Avvia lo stack applicativo

Il file `docker-compose.yml` include anche Caddy (TLS) e n8n, che per l'uso locale non servono.
Crea **`docker-compose.lan.yml`** accanto agli altri:

```yaml
# docker-compose.lan.yml — uso locale/LAN senza Caddy né domini
services:
  web:
    ports:
      - "3000:3000"      # dashboard raggiungibile su http://<IP>:3000
```

Poi:

```bash
docker compose -f docker-compose.yml -f docker-compose.lan.yml \
  up -d --build postgres redis web worker
```

La prima volta il build delle immagini richiede qualche minuto.

### 5. Inizializza il database (solo la prima volta)

```bash
docker compose -f docker-compose.yml -f docker-compose.lan.yml run --rm web npm run db:migrate
docker compose -f docker-compose.yml -f docker-compose.lan.yml run --rm web npm run db:seed
docker compose -f docker-compose.yml -f docker-compose.lan.yml run --rm web \
  npm run create-user -- --email tu@esempio.it --name "Admin" --password "unaPasswordLunga"
```

### 6. Usa

Apri **http://localhost:3000** sul secondo PC e accedi.

Lo stack si riavvia da solo al reboot (`restart: unless-stopped`). Comandi utili:

```bash
docker compose -f docker-compose.yml -f docker-compose.lan.yml ps       # stato
docker compose -f docker-compose.yml -f docker-compose.lan.yml logs -f web
docker compose -f docker-compose.yml -f docker-compose.lan.yml down     # ferma (i dati restano nei volumi)
```

### 7. Aggiornare alla versione più recente

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.lan.yml up -d --build web worker
docker compose -f docker-compose.yml -f docker-compose.lan.yml run --rm web npm run db:migrate
```

---

## Raggiungere la piattaforma da altri dispositivi

### A) Sulla stessa rete locale (Wi-Fi/LAN) — la via più semplice

1. Trova l'IP del secondo PC:
   - Windows: `ipconfig` → *Indirizzo IPv4* (es. `192.168.1.50`)
   - macOS/Linux: `ip addr` / `ifconfig`
2. In `.env` metti quell'IP negli URL e ricrea i container:
   ```dotenv
   AUTH_URL=http://192.168.1.50:3000
   APP_BASE_URL=http://192.168.1.50:3000
   PUBLIC_BASE_URL=http://192.168.1.50:3000
   ```
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.lan.yml up -d web worker
   ```
3. Apri il **firewall** del secondo PC sulla porta **3000** (Windows: *Windows Defender Firewall →
   Regole connessioni in entrata → Nuova regola → Porta → TCP 3000 → Consenti*).
4. Da qualsiasi telefono/PC sulla stessa rete: **`http://192.168.1.50:3000`**.

> Assegna al secondo PC un **IP fisso** (DHCP reservation nel router) così l'indirizzo non cambia.
> La rete locale usa HTTP semplice: va bene per uso interno, non esporre così su Internet.

### B) Da qualsiasi rete, senza aprire porte sul router — **Tailscale** (consigliato)

[Tailscale](https://tailscale.com) crea una VPN privata tra i tuoi dispositivi (piano gratuito
generoso). Nessun port forwarding, nessun IP pubblico.

1. Installa Tailscale sul secondo PC **e** sui dispositivi da cui vuoi collegarti; fai login con lo stesso account.
2. Sul secondo PC prendi il suo nome/IP Tailscale (`tailscale ip -4`, es. `100.x.y.z`).
3. In `.env`: `AUTH_URL=http://100.x.y.z:3000` (idem `APP_BASE_URL`, `PUBLIC_BASE_URL`) e ricrea i container.
4. Da un altro dispositivo con Tailscale attivo: `http://100.x.y.z:3000`.

Con **Tailscale Serve/Funnel** puoi anche ottenere un nome HTTPS
(`https://secondo-pc.tuo-tailnet.ts.net`) senza certificati da gestire.

### C) URL pubblico HTTPS senza IP fisso — **Cloudflare Tunnel**

Se ti serve un indirizzo raggiungibile da chiunque (es. la pagina di consegna al cliente):

1. Dominio su Cloudflare + `cloudflared` installato sul secondo PC.
2. `cloudflared tunnel create automazione-pec`, poi mappa `automazione.tuodominio.it` → `http://localhost:3000`.
3. In `.env` usa quel dominio negli URL (`AUTH_URL=https://automazione.tuodominio.it`, ecc.) e ricrea i container.
4. Il tunnel gestisce TLS; il traffico esce dal secondo PC, niente porte aperte sul router.

### D) Con dominio proprio e certificati — **Caddy** (incluso)

Se il secondo PC ha un IP pubblico raggiungibile e due nomi DNS (dashboard + landing):
usa direttamente `docker-compose.yml` **senza** l'override `.lan.yml`, imposta in `.env`
`APP_DOMAIN`, `PUBLIC_DOMAIN`, `ACME_EMAIL`, e Caddy ottiene i certificati Let's Encrypt in automatico
(`docker compose up -d --build`). Vedi `Caddyfile`.

---

## Manutenzione

```bash
# Backup del database su S3-compatibile (richiede BACKUP_S3_* e pg_dump nel PATH/immagine)
npm run backup
# in Docker:
docker compose ... run --rm worker npm run backup
# schedulalo (cron di sistema):  0 3 * * *  cd /percorso/repo && docker compose ... run --rm worker npm run backup

# Migrazioni dopo un aggiornamento
npm run db:migrate            # locale
docker compose ... run --rm web npm run db:migrate

# Qualità
npm run typecheck             # tsc --noEmit
npm run lint                  # Biome
npm run test                  # Vitest (160 test)
npm run build                 # build di produzione Next
```

---

## Sicurezza

- `.env` **non è versionato** (è in `.gitignore`) — non committarlo mai.
- I 3 segreti (`AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, `TOKEN_SIGNING_KEY`) vanno **diversi per ogni ambiente**.
- L'authcode EPP è cifrato a riposo (AES-256-GCM); il valore in chiaro non finisce mai nei log
  ed è accessibile solo tramite endpoint dedicato che scrive un `AuditLog`.
- I link pubblici (opt-out, consegna) sono **firmati HMAC** con scadenza.
- Il connettore verso spacedomino usa un utente MySQL **dedicato** con permessi minimi
  (`SELECT` su `orders`/`order_items`, `INSERT/UPDATE/DELETE` **solo** su `products`).
- L'accesso SSH al VPS dello storefront va fatto con **utente non-root in sola lettura + chiave**
  (non con la password root).
- Per esporre la dashboard su Internet usa sempre HTTPS (Caddy / Cloudflare Tunnel / Tailscale Funnel),
  mai HTTP semplice.

---

## Stato del progetto

Milestone **1–12 completate**: import, normalizzazione, discovery AI, disponibilità, ranking,
acquisto, offerte + integrazione storefront, bridge vendite, PEC (transport + compose + ricevute),
approvazione + invio PEC + rifinitura AI, trasferimento + consegna, analytics + monitoraggio + backup.

Verifiche: `tsc` pulito · **160 test** Vitest · Biome senza errori · `next build` OK · pipeline
provata end-to-end su Postgres/Redis reali.

Follow-up non bloccanti: invio automatico via email del link di consegna, flusso rimborso,
inizializzazione SDK Sentry/GlitchTip, interfaccia grafica per le aree ancora solo-API.

---

*Il pagamento del cliente avviene interamente sullo storefront spacedomino.it (Stripe di spacedomino):
questa piattaforma non gestisce né conserva chiavi Stripe.*
