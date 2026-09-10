-- Pendiente 177 — alternativas PARA EL CLIENTE dentro de una cotización de
-- muebles. Una partida puede colgar de otra como alternativa (mismo mueble en
-- otro material, otro precio); el cliente ve las dos y la diferencia, y la
-- alternativa no suma en ningún total.
--
-- Es aditivo: una columna NULL, sin default, sin backfill. Ningún dato
-- existente se toca: todas las partidas que hay hoy quedan como base
-- (alternativeOfId IS NULL) y el código viejo la ignora, así que se puede
-- correr antes de desplegar.
--
-- Idempotente: se puede correr dos veces sin efecto.
--
--   psql "$DATABASE_URL" -f prisma/sql/177-mueble-alternativas.sql
--   (o: npx tsx scripts/aplicar-177-columna.ts <ruta-env>)

ALTER TABLE "MuebleItem"
  ADD COLUMN IF NOT EXISTS "alternativeOfId" TEXT;

CREATE INDEX IF NOT EXISTS "MuebleItem_alternativeOfId_idx"
  ON "MuebleItem"("alternativeOfId");

-- Borrar la base borra sus alternativas (ON DELETE CASCADE), igual que el
-- resto de la jerarquía de muebles. Mismo nombre de constraint que generaría
-- Prisma, para que `migrate diff` no lo vea como drift.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MuebleItem_alternativeOfId_fkey'
  ) THEN
    ALTER TABLE "MuebleItem"
      ADD CONSTRAINT "MuebleItem_alternativeOfId_fkey"
      FOREIGN KEY ("alternativeOfId") REFERENCES "MuebleItem"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
