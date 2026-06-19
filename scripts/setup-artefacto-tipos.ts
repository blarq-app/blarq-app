/**
 * Crea la tabla ArtefactoTipo (si no existe) y la siembra con los tipos que
 * antes vivían fijos en el código (TIPO_OPTIONS_BY_SUB de
 * ArtefactosCatalogClient), respetando su orden.
 *
 * Idempotente: se puede correr varias veces. Sirve para dev y para prod.
 *
 * NO usamos `prisma db push` porque la base tiene un drift previo (columna
 * priceOverridden en ArtefactoItem que el schema ya no tiene); un push completo
 * querría dropearla. Esto crea SOLO la tabla nueva, sin tocar nada más.
 *
 * Uso: npx tsx scripts/setup-artefacto-tipos.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Mismos tipos y orden que tenía el código antes de mover esto a la BD.
const TIPOS_INICIALES: Record<string, string[]> = {
  sanitario: [
    "Accesorios",
    "Griferías",
    "Ducha/Receptáculo",
    "Tina",
    "Muebles",
    "Mamparas",
    "WC",
  ],
  cocina: [
    "Lavaplatos",
    "Griferías",
    "Hornos",
    "Encimeras",
    "Campanas",
    "Refrigeración",
    "Lavavajillas",
    "Microondas",
  ],
  iluminacion: [],
};

async function main() {
  // 1) Tabla + índices (idempotente).
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ArtefactoTipo" (
      "id" TEXT NOT NULL,
      "subcategory" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ArtefactoTipo_pkey" PRIMARY KEY ("id")
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "ArtefactoTipo_subcategory_name_key"
      ON "ArtefactoTipo"("subcategory", "name");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ArtefactoTipo_subcategory_sortOrder_idx"
      ON "ArtefactoTipo"("subcategory", "sortOrder");
  `);

  // 2) Sembrar los tipos iniciales (no pisa los que ya estén).
  let creados = 0;
  for (const [subcategory, nombres] of Object.entries(TIPOS_INICIALES)) {
    for (let i = 0; i < nombres.length; i++) {
      const existing = await prisma.artefactoTipo.findUnique({
        where: { subcategory_name: { subcategory, name: nombres[i] } },
      });
      if (existing) continue;
      await prisma.artefactoTipo.create({
        data: { subcategory, name: nombres[i], sortOrder: i },
      });
      creados++;
    }
  }

  const total = await prisma.artefactoTipo.count();
  console.log(`Tabla lista. Tipos creados ahora: ${creados}. Total en BD: ${total}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
