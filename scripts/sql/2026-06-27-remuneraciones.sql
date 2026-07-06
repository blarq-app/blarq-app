-- Migración aditiva e idempotente: tablas de Remuneraciones.
-- Crea Empleado e IndicadorMensual en la base viva (ep-shy-morning) ANTES de
-- mergear el código que las lee, para no romper el F29 en producción.
--
-- Idempotente (IF NOT EXISTS): se puede correr varias veces sin efecto. NO
-- toca ninguna tabla existente. DDL copiada del `prisma migrate diff` (solo la
-- parte de estas dos tablas; se omiten a propósito los ALTER de otras tablas
-- que el diff trae por drift ajeno).
--
-- Aplicar:
--   PROD_URL=...  npx prisma db execute --url "$PROD_URL" \
--     --file scripts/sql/2026-06-27-remuneraciones.sql

CREATE TABLE IF NOT EXISTS "Empleado" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rut" TEXT NOT NULL,
    "sueldoBase" INTEGER NOT NULL,
    "colacion" INTEGER NOT NULL DEFAULT 0,
    "movilizacion" INTEGER NOT NULL DEFAULT 0,
    "afpNombre" TEXT,
    "afpComisionRate" DOUBLE PRECISION NOT NULL,
    "isapreNombre" TEXT,
    "isaprePlanUF" DOUBLE PRECISION NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Empleado_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "IndicadorMensual" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "uf" DOUBLE PRECISION NOT NULL,
    "utm" DOUBLE PRECISION NOT NULL,
    "gratificacionTopeMensual" INTEGER NOT NULL,
    "topeImponibleSaludUF" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndicadorMensual_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Empleado_rut_key" ON "Empleado"("rut");

CREATE UNIQUE INDEX IF NOT EXISTS "IndicadorMensual_year_month_key" ON "IndicadorMensual"("year", "month");
