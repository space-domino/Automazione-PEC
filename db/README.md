# Database

- `schema.prisma` — unica fonte di verità dei modelli.
- `migrations/` — generate da Prisma (`prisma migrate`).
- `sql/hardening.sql` — SQL grezzo (estensioni, CHECK, indici trigram/parziali) da C.4.
- `seed.ts` — dati iniziali idempotenti.

## Prima inizializzazione (dev)

```bash
# 1. Schema -> prima migrazione
npx prisma migrate dev --name init

# 2. Migrazione "hardening" (SQL non esprimibile in schema.prisma)
npx prisma migrate dev --create-only --name hardening
#    Copia il contenuto di db/sql/hardening.sql dentro il migration.sql appena creato
#    (db/migrations/<timestamp>_hardening/migration.sql), poi:
npx prisma migrate dev

# 3. Dati iniziali
npm run db:seed
```

## Produzione (VPS)

```bash
docker compose run --rm web npm run db:migrate   # prisma migrate deploy (applica tutte le migrazioni committate)
docker compose run --rm web npm run db:seed      # solo la prima volta
```

## Modifiche future allo schema

1. Edita `schema.prisma`.
2. `npx prisma migrate dev --name <descrizione>` (genera + applica in dev).
3. Committa la cartella `migrations/<timestamp>_<descrizione>/`.
4. In produzione: `npm run db:migrate`.

Non modificare mai una migrazione già committata: creane una nuova.
