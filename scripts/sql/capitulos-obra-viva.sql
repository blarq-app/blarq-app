-- Capítulos de obra con nombre libre y orden a mano — cambio de estructura
-- para la base VIVA (ep-shy-morning).
--
-- SOLO SUMA: crea una tabla y tres columnas. No borra ni modifica nada de lo
-- que ya existe. Es idempotente (se puede correr dos veces sin romper nada).
--
-- OJO — NO usar `prisma migrate diff` para generar esto. El diff contra la
-- viva mezcla los cambios de esta rama con los de OTRAS ramas en vuelo, y en
-- este momento incluye un `ALTER TABLE "ObraItem" DROP COLUMN "revisado"` que
-- pertenece a otra sesión y tiene 350 valores en la base. Aplicar el diff
-- completo borraría trabajo ajeno. Por eso este archivo se escribió a mano.
--
-- Cómo se aplica (con OK explícito de MJ, ver CLAUDE.md §4.7 y §4.9):
--   npx prisma db execute --url "<DATABASE_URL de la viva>" \
--     --file scripts/sql/capitulos-obra-viva.sql
--
-- Y DESPUÉS, el relleno de datos (dry-run primero):
--   npx tsx scripts/migrar-capitulos-obra.ts .env.prod
--   npx tsx scripts/migrar-capitulos-obra.ts .env.prod --apply

-- 1. La tabla de capítulos. Un capítulo pertenece a una versión de
--    presupuesto; si la versión se borra, sus capítulos se van con ella.
CREATE TABLE IF NOT EXISTS "ObraChapter" (
    "id" TEXT NOT NULL,
    "budgetVersionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ObraChapter_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ObraChapter_budgetVersionId_idx"
    ON "ObraChapter"("budgetVersionId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ObraChapter_budgetVersionId_fkey'
    ) THEN
        ALTER TABLE "ObraChapter"
            ADD CONSTRAINT "ObraChapter_budgetVersionId_fkey"
            FOREIGN KEY ("budgetVersionId") REFERENCES "BudgetVersion"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 2. La partida apunta a su capítulo. Nullable a propósito: así la columna se
--    puede agregar sin romper las 928 partidas que ya existen (se rellenan en
--    el paso siguiente, con el script).
--
--    ON DELETE SET NULL, NO CASCADE: si algún día se borrara un capítulo que
--    tiene partidas, un CASCADE se llevaría puestas partidas presupuestadas.
--    Con SET NULL las partidas sobreviven y la app las muestra en un capítulo
--    de rescate al final para reubicarlas.
ALTER TABLE "ObraItem" ADD COLUMN IF NOT EXISTS "chapterId" TEXT;

CREATE INDEX IF NOT EXISTS "ObraItem_chapterId_idx" ON "ObraItem"("chapterId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ObraItem_chapterId_fkey'
    ) THEN
        ALTER TABLE "ObraItem"
            ADD CONSTRAINT "ObraItem_chapterId_fkey"
            FOREIGN KEY ("chapterId") REFERENCES "ObraChapter"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- 3. El estado de pago guarda su PROPIA copia del capítulo (nombre y
--    posición). Es una foto: una partida que después quede fuera de alcance
--    puede apuntar a un capítulo que ya no existe, y el EP igual tiene que
--    seguir mostrándola en su lugar.
ALTER TABLE "EstadoPagoItem" ADD COLUMN IF NOT EXISTS "chapterName" TEXT;
ALTER TABLE "EstadoPagoItem"
    ADD COLUMN IF NOT EXISTS "chapterOrder" INTEGER NOT NULL DEFAULT 0;

-- NOTA: la columna vieja "ObraItem"."chapter" (la clave de texto) NO se toca.
-- Queda escrita como red de seguridad para poder reconstruir la asignación
-- vieja si algo saliera mal. Se borra en un PR posterior, una vez verificado
-- en producción (lección del incidente #178: no soltar columnas antes de
-- verificar). Lo mismo con "EstadoPagoItem"."chapter".
