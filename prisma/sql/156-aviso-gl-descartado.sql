-- Pendiente 156: columna para descartar el aviso ámbar de GL con la cruz.
-- Solo agrega (texto, puede quedar vacía, sin default): el código que ya está
-- en prod no la lee y sigue funcionando igual. Idempotente.
ALTER TABLE "ObraItem" ADD COLUMN IF NOT EXISTS "avisoGLDescartado" TEXT;
