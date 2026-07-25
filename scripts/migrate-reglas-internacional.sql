-- Migración QUIRÚRGICA y ADITIVA para la base VIVA (ep-shy-morning).
-- Habilita reglas de proveedor por NOMBRE cuando no hay RUT (internacionales).
-- NO correr el `prisma migrate diff` completo contra la viva: arrastra DROPs
-- de otras ramas (ver docs / memoria reference_drift_live_attachmenturl).
--
-- Aplicar SOLO con OK de MJ (§4.7), con:
--   npx prisma db execute --url "<DATABASE_URL de .env.prod>" \
--     --file scripts/migrate-reglas-internacional.sql
--
-- Todo aditivo, sin pérdida de datos:
--   1) rutIssuer pasa a nullable (las 82 reglas actuales tienen RUT, siguen igual).
--   2) providerName nueva columna nullable (clave para internacionales sin RUT).
--   3) índice único en providerName (hoy todo null → no colisiona).

ALTER TABLE "InvoiceCategorizationRule" ALTER COLUMN "rutIssuer" DROP NOT NULL;

ALTER TABLE "InvoiceCategorizationRule" ADD COLUMN IF NOT EXISTS "providerName" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceCategorizationRule_providerName_key"
  ON "InvoiceCategorizationRule" ("providerName");

CREATE INDEX IF NOT EXISTS "InvoiceCategorizationRule_providerName_idx"
  ON "InvoiceCategorizationRule" ("providerName");
