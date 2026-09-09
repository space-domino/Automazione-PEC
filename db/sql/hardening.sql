-- ============================================================================
--  hardening.sql  (sezione C.4 del design)
--  Aggiunte NON esprimibili nello schema Prisma: estensioni, CHECK constraint,
--  indici GIN/trigram e indici parziali.
--
--  COME APPLICARLO come migrazione Prisma:
--    1) npx prisma migrate dev --name init            # crea la migrazione dello schema
--    2) npx prisma migrate dev --create-only --name hardening
--    3) incolla il contenuto di questo file dentro
--       db/migrations/<timestamp>_hardening/migration.sql
--    4) npx prisma migrate dev                         # applica
--  Idempotente: si può rieseguire senza errori.
-- ============================================================================

-- ---- Estensioni ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ---- CHECK constraint -----------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'domain_ai_score_range') THEN
    ALTER TABLE "Domain" ADD CONSTRAINT domain_ai_score_range
      CHECK ("aiScore" IS NULL OR ("aiScore" BETWEEN 0 AND 100));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'domain_ai_conf_range') THEN
    ALTER TABLE "Domain" ADD CONSTRAINT domain_ai_conf_range
      CHECK ("aiConfidence" IS NULL OR ("aiConfidence" BETWEEN 0 AND 100));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'domain_rank_range') THEN
    ALTER TABLE "Domain" ADD CONSTRAINT domain_rank_range
      CHECK ("rankScore" IS NULL OR ("rankScore" BETWEEN 0 AND 100));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'domain_prices_positive') THEN
    ALTER TABLE "Domain" ADD CONSTRAINT domain_prices_positive
      CHECK (COALESCE("purchasePrice", 0) >= 0 AND COALESCE("sellingPrice", 0) >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'offer_price_positive') THEN
    ALTER TABLE "Offer" ADD CONSTRAINT offer_price_positive CHECK ("price" >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_amount_positive') THEN
    ALTER TABLE "Order" ADD CONSTRAINT order_amount_positive CHECK ("amount" >= 0);
  END IF;
END
$$;

-- ---- Indici trigram (ricerca "contains" veloce nella dashboard Aziende) ---
CREATE INDEX IF NOT EXISTS company_legalname_trgm
  ON "Company" USING gin ("legalName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS company_normname_trgm
  ON "Company" USING gin ("normalizedName" gin_trgm_ops);

-- ---- Indici parziali per i job del worker --------------------------------
CREATE INDEX IF NOT EXISTS domain_needs_availability
  ON "Domain" ("createdAt")
  WHERE status = 'DISCOVERED' AND "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS communication_pending_receipts
  ON "Communication" ("sentAt")
  WHERE status IN ('SENT', 'ACCEPTED');
