-- Guarda la última lectura de la tienda como REFERENCIA, con su fecha.
--
-- MJ: "no quiero que se me descuelguen de internet". MK da de baja los
-- productos sin stock y los repone un mes después; cuando eso pasa, "Revisar
-- precios" no puede leer nada y hasta ahora el producto quedaba sin ninguna
-- referencia, indistinguible de uno con el link mal cargado. De los 26
-- productos ilegibles de la base viva, 15 tenían el link caído y los 15 habían
-- funcionado antes.
--
-- Estos campos NO entran en ningún cálculo: lo que se le cobra al cliente sigue
-- saliendo de listPrice y discountPercent. Son solo para poder decir "el 14-07
-- estaba a $X en la tienda" mientras el producto está de baja.
--
-- ADITIVO y nullable: se aplica ANTES del deploy sin romper nada.

ALTER TABLE "ArtefactoCatalog"
  ADD COLUMN IF NOT EXISTS "webListPrice" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "webSalePrice" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "webCheckedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "webUnreadableSince" TIMESTAMP(3);
