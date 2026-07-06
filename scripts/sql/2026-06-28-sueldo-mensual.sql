-- Migración aditiva e idempotente: tabla SueldoMensual (ajuste del sueldo
-- imponible por empleado/mes, para el bono variable). Crear en la base viva
-- ANTES de mergear el código que la lee.
--
-- Solo esta tabla; se omiten a propósito los ALTER de otras tablas que el
-- migrate diff trae por drift ajeno (ArtefactoSubgroupOrder / ArtefactoTipo /
-- HerrajeCatalog).

CREATE TABLE IF NOT EXISTS "SueldoMensual" (
    "id" TEXT NOT NULL,
    "empleadoId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "sueldoBase" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SueldoMensual_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SueldoMensual_empleadoId_idx" ON "SueldoMensual"("empleadoId");

CREATE UNIQUE INDEX IF NOT EXISTS "SueldoMensual_empleadoId_year_month_key" ON "SueldoMensual"("empleadoId", "year", "month");

-- FK idempotente (ADD CONSTRAINT no soporta IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SueldoMensual_empleadoId_fkey'
  ) THEN
    ALTER TABLE "SueldoMensual"
      ADD CONSTRAINT "SueldoMensual_empleadoId_fkey"
      FOREIGN KEY ("empleadoId") REFERENCES "Empleado"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
