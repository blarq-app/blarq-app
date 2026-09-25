-- Ejecutar antes de publicar el código. No modifica presupuestos existentes.
ALTER TABLE "BudgetVersion" ADD COLUMN IF NOT EXISTS "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
