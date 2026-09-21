-- Tiendas conocidas (pendiente 181): tabla donde la app anota las tiendas que
-- aprende sola al extraer un producto (host, plataforma detectada y el link con
-- el que se verificó). Aditivo puro: no toca ninguna tabla existente. Nombres
-- iguales a los que generaría Prisma, para que `migrate diff` no lo vea como
-- drift.
--
-- Idempotente: se puede correr dos veces sin efecto.
--
--   npx tsx scripts/aplicar-sql.ts prisma/sql/181-tiendas-conocidas.sql <ruta-env>

CREATE TABLE IF NOT EXISTS "KnownStore" (
  "id"        TEXT NOT NULL,
  "host"      TEXT NOT NULL,
  "kind"      TEXT NOT NULL DEFAULT 'generico',
  "sampleUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnownStore_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "KnownStore_host_key" ON "KnownStore"("host");
