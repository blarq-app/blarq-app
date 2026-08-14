-- Tabla de etiquetas en espera de los TRASPASOS a Sueldos (bot de Telegram).
--
-- MJ manda el pantallazo del comprobante antes de importar la cartola: la
-- transferencia todavía no existe en la app, así que la intención (obra +
-- concepto) se guarda acá y el import la aplica sola al detectar el traspaso.
--
-- Escrito a mano y no con `prisma migrate diff` a propósito: el diff completo
-- contra la base viva arrastra DROPs de columnas de otras ramas sin mergear.
-- Esto es puramente aditivo — crea una tabla nueva y no toca ninguna existente.
-- Idempotente: se puede correr dos veces sin romper.
--
-- Aplicar:  psql "$DATABASE_URL" -f scripts/migrate-pending-transfer-tag.sql

CREATE TABLE IF NOT EXISTS "PendingTransferTag" (
  "id"                  TEXT NOT NULL,
  "transferDate"        TIMESTAMP(3) NOT NULL,
  "amount"              DOUBLE PRECISION NOT NULL,
  "bankName"            TEXT,
  "destination"         TEXT,
  "projectId"           TEXT NOT NULL,
  "concepto"            TEXT,
  "requestedBy"         TEXT,
  "requestedByName"     TEXT,
  "status"              TEXT NOT NULL DEFAULT 'esperando',
  "appliedToMovementId" TEXT,
  "appliedAt"           TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PendingTransferTag_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PendingTransferTag_status_transferDate_idx"
  ON "PendingTransferTag"("status", "transferDate");

CREATE INDEX IF NOT EXISTS "PendingTransferTag_status_idx"
  ON "PendingTransferTag"("status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PendingTransferTag_projectId_fkey'
  ) THEN
    ALTER TABLE "PendingTransferTag"
      ADD CONSTRAINT "PendingTransferTag_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
