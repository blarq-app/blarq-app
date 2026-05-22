// Corrige artefactos mal cargados: el campo clientPrice tenía el TOTAL de
// la línea en vez del precio unitario. Para los proyectos/versiones de la
// lista blanca, cada artefactoItem con quantity > 1 pasa a precio unitario
// (clientPrice / quantity).
//
// Contexto: hasta 2026-05-22 metrics.ts sumaba clientPrice SIN multiplicar
// por quantity, así que el dato mal cargado "calzaba" con los cuadros al
// cliente. Al pasar metrics.ts a multiplicar (convención correcta), hubo
// que corregir estos datos. NO se corrigen todos los proyectos: solo los
// verificados como mal cargados contra su cuadro resumen. Quedan FUERA, por
// estar bien cargados (precio ya unitario): Paseo del Sena (cargado a mano
// en la app) y Portofino V6 (calza con multiplicar).
//
// Es un script de migración de UN SOLO USO. Correrlo dos veces vuelve a
// dividir precios ya corregidos y los rompe.
//
// Uso:
//   npx tsx scripts/fix-artefactos-precio-unitario.ts          (dry-run)
//   npx tsx scripts/fix-artefactos-precio-unitario.ts --apply   (escribe)

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

// Lista blanca: { nombre de proyecto (contains), versión de artefactos }.
const MAL_CARGADOS: { proyecto: string; version: string }[] = [
  { proyecto: "Francisco de Aguirre", version: "V7" },
  { proyecto: "Cocina Farellones", version: "V4" },
  { proyecto: "JNC-Vitacura", version: "V5" },
  { proyecto: "Portofino", version: "V1" },
];

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "[APLICANDO]" : "[dry-run]");

  let totalItems = 0;
  for (const { proyecto, version } of MAL_CARGADOS) {
    const bv = await prisma.budgetVersion.findFirst({
      where: {
        type: "artefactos",
        version,
        project: { name: { contains: proyecto, mode: "insensitive" } },
      },
      include: {
        artefactoItems: true,
        project: { select: { name: true } },
      },
    });
    if (!bv) {
      console.log(`  AVISO: no se encontró ${proyecto} artefactos ${version}`);
      continue;
    }
    const aCorregir = bv.artefactoItems.filter((i) => i.quantity > 1);
    console.log(
      `\n${bv.project.name} — artefactos ${version} (${aCorregir.length} ítems con cantidad > 1)`
    );
    for (const it of aCorregir) {
      const nuevo = it.clientPrice / it.quantity;
      console.log(
        `  "${it.name ?? ""}"  qty=${it.quantity}  ` +
          `${Math.round(it.clientPrice).toLocaleString("es-CL")} → ` +
          `${nuevo.toLocaleString("es-CL")} c/u`
      );
      if (apply) {
        await prisma.artefactoItem.update({
          where: { id: it.id },
          data: { clientPrice: nuevo },
        });
      }
      totalItems++;
    }
  }

  console.log(
    apply
      ? `\nListo. ${totalItems} ítems corregidos a precio unitario.`
      : `\nDry-run. ${totalItems} ítems se corregirían. Correr con --apply.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
