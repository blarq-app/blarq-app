-- Migración aditiva e idempotente: campos de Empleado para el archivo Previred.
-- Todos nullable (TEXT). No tocan datos existentes.

ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "sexo" TEXT;
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "apellidoPaterno" TEXT;
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "apellidoMaterno" TEXT;
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "nombres" TEXT;
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "isapreCodigo" TEXT;
ALTER TABLE "Empleado" ADD COLUMN IF NOT EXISTS "isapreFun" TEXT;
