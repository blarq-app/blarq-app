-- ALTER quirúrgico para la base VIVA (ep-shy-morning): reparto por maestro.
-- SOLO cambios aditivos de esta feature. NO toca Invoice.attachmentUrl ni los
-- DROP DEFAULT de Artefacto*/Herraje* que aparecían en el diff automático (drift
-- de otras ramas). Aprobado por MJ (§4.7). Todo dentro de una transacción.

BEGIN;

-- ObraItem.maestroId (una partida = un maestro; null = sin asignar)
ALTER TABLE "ObraItem" ADD COLUMN IF NOT EXISTS "maestroId" TEXT;
CREATE INDEX IF NOT EXISTS "ObraItem_maestroId_idx" ON "ObraItem"("maestroId");
ALTER TABLE "ObraItem"
  ADD CONSTRAINT "ObraItem_maestroId_fkey"
  FOREIGN KEY ("maestroId") REFERENCES "Maestro"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- EstadoPago.maestroId (Opción B: serie propia por maestro)
ALTER TABLE "EstadoPago" ADD COLUMN IF NOT EXISTS "maestroId" TEXT;
CREATE INDEX IF NOT EXISTS "EstadoPago_maestroId_idx" ON "EstadoPago"("maestroId");
ALTER TABLE "EstadoPago"
  ADD CONSTRAINT "EstadoPago_maestroId_fkey"
  FOREIGN KEY ("maestroId") REFERENCES "Maestro"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Numeración de EP por (proyecto, maestro): reemplaza el unique por proyecto.
DROP INDEX IF EXISTS "EstadoPago_projectId_number_key";
CREATE UNIQUE INDEX IF NOT EXISTS "EstadoPago_projectId_maestroId_number_key"
  ON "EstadoPago"("projectId", "maestroId", "number");

-- ProjectMaestro (obra ↔ varios maestros)
CREATE TABLE IF NOT EXISTS "ProjectMaestro" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "maestroId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectMaestro_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProjectMaestro_projectId_idx" ON "ProjectMaestro"("projectId");
CREATE INDEX IF NOT EXISTS "ProjectMaestro_maestroId_idx" ON "ProjectMaestro"("maestroId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectMaestro_projectId_maestroId_key"
  ON "ProjectMaestro"("projectId", "maestroId");
ALTER TABLE "ProjectMaestro"
  ADD CONSTRAINT "ProjectMaestro_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectMaestro"
  ADD CONSTRAINT "ProjectMaestro_maestroId_fkey"
  FOREIGN KEY ("maestroId") REFERENCES "Maestro"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
