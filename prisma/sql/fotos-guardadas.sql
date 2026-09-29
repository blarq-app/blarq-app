-- Cajón de fotos (2026-09-27): tabla donde la app guarda una COPIA de cada foto
-- de artefactos y herrajes, para que no desaparezca cuando la tienda cambia sus
-- fotos. Ver el modelo `FotoGuardada` en schema.prisma y
-- docs/decisions/2026-09-27-fotos-copia-en-la-app.md.
--
-- Aditivo puro: no toca ninguna tabla existente. Nombres iguales a los que
-- genera Prisma (`migrate diff --from-empty`), para que no aparezca como drift.
--
-- Idempotente: se puede correr dos veces sin efecto.
--
--   npx tsx scripts/aplicar-sql.ts prisma/sql/fotos-guardadas.sql <ruta-env>

CREATE TABLE IF NOT EXISTS "FotoGuardada" (
    "id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "sourceUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mime" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FotoGuardada_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FotoGuardada_hash_key" ON "FotoGuardada"("hash");
CREATE INDEX IF NOT EXISTS "FotoGuardada_sourceUrls_idx" ON "FotoGuardada" USING GIN ("sourceUrls");
