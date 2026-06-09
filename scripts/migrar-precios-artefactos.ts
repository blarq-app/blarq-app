/**
 * Migración de precios del catálogo de artefactos (rediseño 2026-06).
 *
 * Contexto: el catálogo pasa de guardar "precio lista + un descuento" a
 * guardar 3 cosas → precio web (listPrice), precio a cliente (clientPrice)
 * y mi costo real (realCostBlarq).
 *
 * Decisión de MJ: "empezar de cero" — los descuentos viejos (−20%, −33%…)
 * NO son confiables, así que se descartan. Para cada artefacto existente:
 *   - clientPrice  ← listPrice  (al cliente le vende al precio de internet)
 *   - discountPercent ← null    (se descarta el descuento viejo)
 *   - realCostBlarq quedó null por la columna nueva → lo carga a mano
 *
 * Idempotente: si clientPrice ya tiene valor, no lo pisa.
 *
 * Uso:
 *   DEV : npx tsx scripts/migrar-precios-artefactos.ts
 *   PROD: DATABASE_URL="<url prod>" npx tsx scripts/migrar-precios-artefactos.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const items = await prisma.artefactoCatalog.findMany({
    select: { id: true, name: true, listPrice: true, clientPrice: true },
  });

  let actualizados = 0;
  for (const it of items) {
    // Si ya tiene precio a cliente cargado, no lo tocamos (idempotente).
    const clientPrice = it.clientPrice ?? it.listPrice;
    await prisma.artefactoCatalog.update({
      where: { id: it.id },
      data: {
        clientPrice,
        discountPercent: null, // descartar el descuento viejo
      },
    });
    actualizados++;
  }

  console.log(`Artefactos en catálogo: ${items.length}`);
  console.log(`Actualizados (clientPrice = precio web, descuento viejo borrado): ${actualizados}`);
}

main()
  .catch((e) => {
    console.error("Error en la migración:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
