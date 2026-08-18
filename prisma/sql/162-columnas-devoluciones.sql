-- Pendiente 162 — columnas nuevas para las devoluciones y las notas de crédito
-- partidas. Es aditivo: tres columnas NULL, sin default, sin backfill. Ningún
-- dato existente se toca y el código viejo las ignora, así que se puede correr
-- antes de desplegar.
--
-- Idempotente: se puede correr dos veces sin efecto.
--
--   psql "$DATABASE_URL" -f prisma/sql/162-columnas-devoluciones.sql

-- Cuánto de un movimiento quedó neteado contra su devolución. Cuando cubre el
-- movimiento entero es una devolución pura; cuando cubre solo el sobrante, el
-- movimiento sigue conciliado a su factura y deja de figurar como parcial.
ALTER TABLE "BankMovement"
  ADD COLUMN IF NOT EXISTS "netZeroAmount" DOUBLE PRECISION;

-- Reparto de una nota de crédito entre sus dos destinos: cuánto paga la factura
-- y cuánto vuelve por el banco. NULL en los modos de un solo destino, que se
-- leen como "va todo ahí".
ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "appliedAmount" DOUBLE PRECISION;
ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "refundAmount" DOUBLE PRECISION;
