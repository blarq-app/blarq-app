/**
 * Backfill del catálogo BLARQ de artefactos.
 *
 * Recorre TODOS los ArtefactoItem que todavía no están vinculados al
 * catálogo (catalogId = null) y, por cada uno:
 *   - si ya existe una entrada de catálogo con el mismo nombre
 *     (case-insensitive), lo vincula a esa;
 *   - si no, crea la entrada y lo vincula.
 *
 * Así el catálogo se puebla de una con toda la variedad histórica de
 * artefactos cotizados. De ahí en adelante el catálogo se mantiene solo
 * (cada alta nueva ya entra automáticamente).
 *
 * Uso:
 *   npx tsx scripts/backfill-artefacto-catalog.ts            (dry-run)
 *   npx tsx scripts/backfill-artefacto-catalog.ts --apply    (escribe)
 *
 * Idempotente: correrlo de nuevo no duplica nada.
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(
    apply
      ? "=== BACKFILL CATÁLOGO ARTEFACTOS — APLICANDO CAMBIOS ==="
      : "=== BACKFILL CATÁLOGO ARTEFACTOS — DRY-RUN (sin --apply) ==="
  );

  // Items sin vincular al catálogo.
  const items = await prisma.artefactoItem.findMany({
    where: { catalogId: null },
    orderBy: { id: "asc" },
  });
  console.log(`Items sin catalogId: ${items.length}`);

  // Catálogo actual indexado por nombre normalizado (minúsculas, trim).
  const catalogo = await prisma.artefactoCatalog.findMany({
    select: { id: true, name: true },
  });
  const porNombre = new Map<string, string>();
  for (const c of catalogo) {
    porNombre.set(c.name.trim().toLowerCase(), c.id);
  }
  console.log(`Entradas de catálogo existentes: ${catalogo.length}`);

  let creadas = 0;
  let reusadas = 0;
  let sinNombre = 0;

  for (const it of items) {
    const nombre = it.name?.trim();
    if (!nombre) {
      sinNombre++;
      continue;
    }
    const key = nombre.toLowerCase();
    let catalogId = porNombre.get(key);

    if (!catalogId) {
      if (apply) {
        const created = await prisma.artefactoCatalog.create({
          data: {
            name: nombre,
            detail: it.detail,
            brand: it.brand,
            subcategory: it.subcategory || "sanitario",
            referenceLink: it.referenceLink,
            imageUrl: it.imageUrl,
            listPrice: it.listPrice ?? 0,
            discountPercent: it.discountPercent,
            isStandard: false,
            lastPriceCheck:
              (it.listPrice ?? 0) > 0 ? new Date() : null,
          },
          select: { id: true },
        });
        catalogId = created.id;
      } else {
        // En dry-run usamos un placeholder para contar sin escribir.
        catalogId = `(nueva: ${nombre})`;
      }
      porNombre.set(key, catalogId);
      creadas++;
    } else {
      reusadas++;
    }

    if (apply && !catalogId.startsWith("(nueva:")) {
      await prisma.artefactoItem.update({
        where: { id: it.id },
        data: { catalogId },
      });
    }
  }

  console.log("");
  console.log(`Entradas de catálogo nuevas:  ${creadas}`);
  console.log(`Items vinculados a entrada ya existente: ${reusadas}`);
  console.log(`Items sin nombre (omitidos): ${sinNombre}`);
  console.log(
    `Total items que quedan vinculados: ${creadas + reusadas} de ${items.length}`
  );
  if (!apply) {
    console.log("\n(dry-run — no se escribió nada. Correr con --apply.)");
  } else {
    console.log("\n✓ Aplicado.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
