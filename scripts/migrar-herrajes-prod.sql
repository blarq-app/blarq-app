-- Migración a PROD del catálogo de herrajes (Fase 1/2/3). SOLO ADITIVO.
-- Idempotente (IF NOT EXISTS) para poder re-correr sin romper. NO contiene
-- ningún DROP de columnas/datos: deja intacto todo lo existente en prod.
-- Generado a partir de `prisma migrate diff` y depurado a mano (se sacaron los
-- DROP DEFAULT de ArtefactoSubgroupOrder/ArtefactoTipo, que son drift ajeno).

-- Marca de tipo de partida de mueble (default 'mueble' = no cambia las existentes).
ALTER TABLE "MuebleItem" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'mueble';

-- Línea de herraje dentro de una partida de muebles.
CREATE TABLE IF NOT EXISTS "MuebleHerraje" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "catalogId" TEXT,
    "sector" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "measure" TEXT,
    "finish" TEXT,
    "sku" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "costNet" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MuebleHerraje_pkey" PRIMARY KEY ("id")
);

-- Catálogo de herrajes.
CREATE TABLE IF NOT EXISTS "HerrajeCatalog" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "detail" TEXT,
    "supplier" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subgroup" TEXT,
    "measure" TEXT,
    "finish" TEXT,
    "brand" TEXT,
    "sku" TEXT,
    "referenceLink" TEXT,
    "imageUrl" TEXT,
    "costNet" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "clientPrice" DOUBLE PRECISION,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "lastPriceCheck" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HerrajeCatalog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MuebleHerraje_itemId_idx" ON "MuebleHerraje"("itemId");
CREATE INDEX IF NOT EXISTS "MuebleHerraje_catalogId_idx" ON "MuebleHerraje"("catalogId");
CREATE INDEX IF NOT EXISTS "HerrajeCatalog_supplier_idx" ON "HerrajeCatalog"("supplier");
CREATE INDEX IF NOT EXISTS "HerrajeCatalog_category_idx" ON "HerrajeCatalog"("category");
CREATE INDEX IF NOT EXISTS "HerrajeCatalog_supplier_category_sortOrder_idx" ON "HerrajeCatalog"("supplier", "category", "sortOrder");

-- FK de la línea de herraje a su partida (idempotente).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MuebleHerraje_itemId_fkey') THEN
    ALTER TABLE "MuebleHerraje" ADD CONSTRAINT "MuebleHerraje_itemId_fkey"
      FOREIGN KEY ("itemId") REFERENCES "MuebleItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
