import "dotenv/config";
import { prisma } from "../src/lib/prisma";

/**
 * Diagnóstico SOLO LECTURA. No modifica nada.
 *
 * Objetivo: detectar partidas (ObraItem) donde el desglose guardado arriba
 * (costMaterial/costLabor/costMargin/...) NO coincide con la suma de los
 * componentes del detalle, y de paso revelar si esos componentes vinieron
 * COPIADOS del catálogo (originComponentId != null) en vez de reconstruidos
 * desde lo que se cotizó ("(monto original)").
 *
 * Paso 1: foco en la partida del módulo eléctrico en el dpto de Colón.
 * Paso 2: escaneo de todo el presupuesto de ese proyecto.
 */

const peso = (n: number | null | undefined) =>
  "$" + Math.round(n ?? 0).toLocaleString("es-CL");

function sumarPorTipo(
  comps: { type: string; totalCost: number }[],
  tipo: string
) {
  return comps
    .filter((c) => c.type === tipo)
    .reduce((s, c) => s + (c.totalCost ?? 0), 0);
}

async function main() {
  // --- Encontrar la partida puntual ---------------------------------------
  const candidatas = await prisma.obraItem.findMany({
    where: {
      name: { contains: "modulo", mode: "insensitive" },
    },
    include: {
      components: { orderBy: { sortOrder: "asc" } },
      budgetVersion: { include: { project: true } },
    },
  });

  // Filtramos a las que el proyecto suene a "colon"
  const colon = candidatas.filter((it) =>
    (it.budgetVersion.project.name ?? "")
      .toLowerCase()
      .includes("colon")
  );

  const objetivo = colon.length > 0 ? colon : candidatas;

  console.log("=".repeat(70));
  console.log("PASO 1 — Partida(s) que matchean 'modulo'");
  console.log("=".repeat(70));

  for (const it of objetivo) {
    console.log("");
    console.log(`Proyecto:  ${it.budgetVersion.project.name}`);
    console.log(
      `Versión:   ${it.budgetVersion.version} (${it.budgetVersion.status})`
    );
    console.log(`Partida:   ${it.name}`);
    console.log(`Cantidad:  ${it.quantity}  ·  Precio unit: ${peso(it.unitPrice)}  ·  Total: ${peso(it.total)}`);
    console.log("");
    console.log("  DESGLOSE GUARDADO ARRIBA (lo que muestra el resumen):");
    console.log(`    Material      ${peso(it.costMaterial)}`);
    console.log(`    Mano de obra  ${peso(it.costLabor)}`);
    console.log(`    Herramientas  ${peso(it.costTools)}`);
    console.log(`    Subcontrato   ${peso(it.costSubcontract)}`);
    console.log(`    Pérdida       ${peso(it.costLoss)}`);
    console.log(`    Margen        ${peso(it.costMargin)}`);
    const sumaArriba =
      (it.costMaterial ?? 0) +
      (it.costLabor ?? 0) +
      (it.costTools ?? 0) +
      (it.costSubcontract ?? 0) +
      (it.costLoss ?? 0) +
      (it.costMargin ?? 0);
    console.log(`    SUMA          ${peso(sumaArriba)}`);
    console.log("");
    console.log("  DETALLE (componentes):");
    if (it.components.length === 0) {
      console.log("    (sin componentes)");
    }
    for (const c of it.components) {
      const origen = c.originComponentId
        ? "← COPIADO DEL CATÁLOGO"
        : c.isCustomized
        ? "← editado a mano (mod)"
        : "← sin origen (manual o data vieja)";
      console.log(
        `    [${c.type.padEnd(12)}] ${c.description.padEnd(28)} ` +
          `cant ${String(c.quantity).padStart(6)} ${c.unit.padEnd(3)} ` +
          `costo ${peso(c.unitCost).padStart(10)} = ${peso(c.totalCost).padStart(10)}  ${origen}`
      );
    }
    const sumaDetalle = it.components.reduce(
      (s, c) => s + (c.totalCost ?? 0),
      0
    );
    console.log(`    SUMA DETALLE  ${peso(sumaDetalle)}`);
    console.log("");
    console.log("  COMPARACIÓN por tipo (arriba vs detalle):");
    const filas: [string, number, string][] = [
      ["Material", it.costMaterial ?? 0, "material"],
      ["Mano obra", it.costLabor ?? 0, "mano_obra"],
      ["Herram.", it.costTools ?? 0, "herramientas"],
      ["Subcontr.", it.costSubcontract ?? 0, "subcontrato"],
      ["Pérdida", it.costLoss ?? 0, "perdida"],
      ["Margen", it.costMargin ?? 0, "margen"],
    ];
    for (const [label, arriba, tipo] of filas) {
      const abajo = sumarPorTipo(it.components, tipo);
      const flag = Math.abs(arriba - abajo) > 1 ? "  <-- DIFIERE" : "";
      console.log(
        `    ${label.padEnd(10)} arriba ${peso(arriba).padStart(10)}  |  detalle ${peso(abajo).padStart(10)}${flag}`
      );
    }
    const copiados = it.components.filter((c) => c.originComponentId).length;
    console.log("");
    console.log(
      `  VEREDICTO: ${copiados}/${it.components.length} componentes vienen COPIADOS del catálogo.`
    );
  }

  // --- Paso 2: escaneo del/los presupuesto(s) del proyecto ----------------
  if (objetivo.length > 0) {
    const projectIds = [
      ...new Set(objetivo.map((it) => it.budgetVersion.projectId)),
    ];
    console.log("");
    console.log("=".repeat(70));
    console.log("PASO 2 — Escaneo de TODAS las partidas de ese/esos proyecto(s)");
    console.log("=".repeat(70));

    for (const pid of projectIds) {
      const proj = await prisma.project.findUnique({ where: { id: pid } });
      const items = await prisma.obraItem.findMany({
        where: { budgetVersion: { projectId: pid } },
        include: {
          components: true,
          budgetVersion: { select: { version: true, status: true } },
        },
        orderBy: { sortOrder: "asc" },
      });

      console.log("");
      console.log(`### Proyecto: ${proj?.name}  (${items.length} partidas con componentes o no)`);

      let conDetalle = 0;
      let desincronizadas = 0;
      const problemáticas: string[] = [];

      for (const it of items) {
        if (it.components.length === 0) continue;
        conDetalle++;
        const tipos: [number, string][] = [
          [it.costMaterial ?? 0, "material"],
          [it.costLabor ?? 0, "mano_obra"],
          [it.costTools ?? 0, "herramientas"],
          [it.costSubcontract ?? 0, "subcontrato"],
          [it.costLoss ?? 0, "perdida"],
          [it.costMargin ?? 0, "margen"],
        ];
        const difiere = tipos.some(
          ([arriba, tipo]) =>
            Math.abs(arriba - sumarPorTipo(it.components, tipo)) > 1
        );
        const copiados = it.components.filter((c) => c.originComponentId).length;
        if (difiere) {
          desincronizadas++;
          problemáticas.push(
            `   [${it.budgetVersion.version} ${it.budgetVersion.status}] ${it.name} ` +
              `— arriba ${peso(it.unitPrice)} vs detalle ` +
              `${peso(it.components.reduce((s, c) => s + (c.totalCost ?? 0), 0))} ` +
              `(${copiados}/${it.components.length} del catálogo)`
          );
        }
      }

      console.log(`  Partidas con detalle: ${conDetalle}`);
      console.log(`  Desincronizadas (arriba ≠ detalle): ${desincronizadas}`);
      if (problemáticas.length > 0) {
        console.log("  Listado:");
        problemáticas.forEach((p) => console.log(p));
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
