# Analytics, monitoraggio e backup (Milestone 12)

## Analytics — `services/analytics`

| Funzione | Endpoint | Contenuto |
|---|---|---|
| `getDashboard()` | `GET /api/analytics/summary` (admin, cache Redis 60s) | funnel completo (aziende → domini analizzati/disponibili/acquistati → offerte pubblicate → PEC inviate/consegnate → ordini pagati → trasferiti), statistiche PEC (per stato, delivery/failure rate), vendite (ordini per stato, ricavi totali/30g/7g, valore medio), trasferimenti (to_start/in_progress/failed/done), costo AI. |
| `getFunnelTimeseries(days)` | `GET /api/analytics/funnel?days=30` (admin) | serie giornaliere: aziende, domini, offerte, PEC inviate/consegnate, ordini, ricavi, trasferimenti. |

Restano attivi anche `GET /api/overview` e `GET /api/analytics/timeseries` (versioni base delle milestone precedenti).

## Monitoraggio — `services/monitoring/health`

`systemHealth()` compone: `database`, `redis`, `worker` (heartbeat file `worker-alive`: ok <90s, warn <5m, down oltre), `queues` (job falliti / coda troppo lunga), `pec` (login SMTP + IMAP, se configurata), `storefront` (ping MySQL, se collegato), più i **check di rischio** (`riskChecks()`):

- `availability_stale` — domini `UNKNOWN`/`ERROR` con verifica più vecchia di 3 giorni
- `pec_stuck` — `Communication` ferme in `SENDING` da >1h
- `transfer_stuck` — trasferimenti aperti (`TRANSFER_PENDING`) da >14 giorni
- `jobs_failed_24h` — `JobRecord` falliti nelle ultime 24h
- `ai_budget` — spesa AII 24h oltre `ai.daily_budget_usd`

Rollup: un check `down` → stato `down`; un check `warn` → `degraded`; altrimenti `ok`.

| Endpoint | Uso |
|---|---|
| `GET /api/health` | shallow (db + redis) — per load balancer / uptime monitor |
| `GET /api/health?deep=1` | = `systemHealth()` (503 se `down`) |
| `GET /api/monitoring` (admin) | `systemHealth()` completo |

## Alert e notifiche — `services/monitoring/alerts`

`raiseAlert({type, title, body?, severity?, data?, dedupeKey?})` → crea una riga `Notification`;
con `dedupeKey`, salta se ne esiste già una **non letta** con stesso `type` + chiave nelle ultime 6h.
Se `N8N_WEBHOOK_URL` è impostata, inoltra l'alert al webhook (`Bearer N8N_WEBHOOK_TOKEN`).

`scanForAlerts()` — esegue `riskChecks()` + i check infrastrutturali e alza un alert per ogni anomalia.
Job ripetibile **`monitoring.scan`** ogni 15 min (coda `monitoring`, sempre attiva).

| Endpoint (admin) | |
|---|---|
| `GET /api/notifications?unread=1` | elenco + contatore non lette |
| `POST /api/notifications/:id/read` · `POST /api/notifications/read-all` | segna come lette |

## Backup off-site — `scripts/backup.ts`

```
npm run backup
```

`pg_dump` (URI `DATABASE_URL`, formato plain) → `gzip -9` → `PUT` su bucket S3-compatibile
con firma **AWS SigV4** implementata in `lib/s3.ts` (nessuna dipendenza; path-style).
Chiave oggetto: `pg/drp-YYYYMMDD-HHMMSS.sql.gz`.

Requisiti:
- `pg_dump` nel `PATH` (pacchetto `postgresql-client`, presente nell'immagine `postgres`);
- `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_KEY`, `BACKUP_S3_SECRET`, `BACKUP_S3_BUCKET`.

Schedulazione: cron di sistema o `docker compose` sidecar, es. giornaliero
`0 3 * * *  cd /app && npm run backup`. La **retention** si configura come lifecycle
policy sul bucket (es. elimina oggetti `pg/` più vecchi di `BACKUP_RETENTION_DAYS`).

## Error tracking

`SENTRY_DSN` / `GLITCHTIP_DSN` sono previsti in `lib/env.ts` (`features.errorTracking`);
l'inizializzazione dell'SDK va aggiunta in `app` e `worker` quando si sceglie il provider.
