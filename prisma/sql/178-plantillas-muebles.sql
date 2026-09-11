-- Plantillas de muebles: tres tablas nuevas (capítulo tipo, partida tipo y sus
-- componentes). Aditivo puro: no toca ninguna tabla existente. Nombres de
-- tablas, índices y constraints iguales a los que generaría Prisma, para que
-- `migrate diff` no lo vea como drift.
--
-- Idempotente: se puede correr dos veces sin efecto.
--
--   npx tsx scripts/aplicar-178-plantillas.ts <ruta-env>

CREATE TABLE IF NOT EXISTS "MuebleChapterTemplate" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MuebleChapterTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MuebleChapterTemplate_name_key" ON "MuebleChapterTemplate"("name");

CREATE TABLE IF NOT EXISTS "MuebleItemTemplate" (
  "id"                 TEXT NOT NULL,
  "chapterTemplateId"  TEXT,
  "name"               TEXT NOT NULL,
  "kind"               TEXT NOT NULL DEFAULT 'mueble',
  "descriptionGeneral" TEXT,
  "supplier"           TEXT,
  "utilityPercentage"  DOUBLE PRECISION,
  "sortOrder"          INTEGER NOT NULL DEFAULT 0,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MuebleItemTemplate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MuebleItemTemplate_chapterTemplateId_idx" ON "MuebleItemTemplate"("chapterTemplateId");

CREATE TABLE IF NOT EXISTS "MuebleItemTemplateDetail" (
  "id"         TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "material"   TEXT NOT NULL,
  "sortOrder"  INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "MuebleItemTemplateDetail_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MuebleItemTemplateDetail_templateId_idx" ON "MuebleItemTemplateDetail"("templateId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MuebleItemTemplate_chapterTemplateId_fkey') THEN
    ALTER TABLE "MuebleItemTemplate"
      ADD CONSTRAINT "MuebleItemTemplate_chapterTemplateId_fkey"
      FOREIGN KEY ("chapterTemplateId") REFERENCES "MuebleChapterTemplate"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MuebleItemTemplateDetail_templateId_fkey') THEN
    ALTER TABLE "MuebleItemTemplateDetail"
      ADD CONSTRAINT "MuebleItemTemplateDetail_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES "MuebleItemTemplate"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
