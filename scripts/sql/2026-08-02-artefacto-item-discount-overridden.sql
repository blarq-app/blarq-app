-- Separa "el descuento lo puso MJ" de "el descuento viene de la tienda".
--
-- Contexto: hasta ahora un solo número guardaba las dos cosas, así que mover el
-- porcentaje despegaba la línea entera (priceOverridden) y esa cotización
-- dejaba de recibir los precios del catálogo para siempre. Con esta marca, el
-- catálogo puede seguir actualizando el precio de LISTA aunque el descuento sea
-- una decisión de MJ.
--
-- Es ADITIVO y con default: se puede aplicar ANTES del deploy sin romper nada
-- (el código viejo ignora la columna). De hecho HAY que aplicarlo antes, porque
-- el código nuevo la lee.
--
-- Todas las líneas existentes nacen en false = "el descuento es de la tienda".
-- Es a propósito: no hay forma de saber cuáles ajustó MJ a mano y cuáles
-- quedaron viejas, así que no se adivina. Ninguna cotización cambia de precio.

ALTER TABLE "ArtefactoItem"
  ADD COLUMN IF NOT EXISTS "discountOverridden" BOOLEAN NOT NULL DEFAULT false;
