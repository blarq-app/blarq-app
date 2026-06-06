/**
 * PASO 0 — Diagnóstico SOLO LECTURA del descuadre encabezado-vs-desglose.
 *
 * No escribe NADA. Recorre todas las versiones de presupuesto de obra y, por
 * cada partida que tiene desglose (componentes), compara:
 *   - encabezado  = unitPrice guardado (lo que ve el cliente, P.U. unitario)
 *   - desglose    = Σ effectiveTotal(componente)  (la suma "real" de abajo)
 * y reporta la diferencia. Las partidas SIN componentes ("en bruto") se cuentan
 * aparte: no tienen descuadre medible, el encabezado es la única verdad.
 *
 * effectiveTotal replica EXACTO src/lib/catalog/recalcObraItem.ts (no se importa
 * para que el script sea autocontenido y corra con cualquier client generado).
 *
 * Uso:
 *   DATABASE_URL=<prod> npx tsx scripts/diagnostico-descuadre-partidas.ts
 *   ... [--proyecto "Colon"]   # filtra por nombre de proyecto (case-insensitive)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Tolerancia en pesos para considerar "descuadrado" (evita ruido de coma flotante)
const TOL = 1;

type Comp = {
  id: string;
  type: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  appliedToComponentId: string | null;
  appliedToType: string | null;
};

// Espejo exacto de effectiveTotal en recalcObraItem.ts
function effectiveTotal(comp: Comp, all: Comp[]): number {
  const pct = comp.quantity || 0;
  if (comp.unit !== "%") {
    return (comp.quantity || 0) * (comp.unitCost || 0);
  }
  if (comp.type === "perdida" && comp.appliedToComponentId) {
    const target = all.find((c) => c.id === comp.appliedToComponentId);
    if (!target) return 0;
    return effectiveTotal(target, all) * (pct / 100);
  }
  if (comp.type === "mano_obra" && comp.appliedToType === "mano_obra") {
    const moBase = all
      .filter((c) => c.type === "mano_obra" && c.unit !== "%" && c.id !== comp.id)
      .reduce((s, c) => s + effectiveTotal(c, all), 0);
    return moBase * (pct / 100);
  }
  if (comp.type === "margen") {
    const base = all
      .filter((c) => c.id !== comp.id && c.type !== "margen" && c.type !== "perdida")
      .reduce((s, c) => s + effectiveTotal(c, all), 0);
    return base * (pct / 100);
  }
  return (comp.quantity || 0) * (comp.unitCost || 0);
}

const clp = (n: number) =>
  "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  const filtro = process.argv.includes("--proyecto")
    ? process.argv[process.argv.indexOf("--proyecto") + 1]?.toLowerCase()
    : null;

  const projects = await prisma.project.findMany({
    select: {
      id: true,
      name: true,
      budgetVersions: {
        where: { type: "obra" },
        orderBy: [{ version: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          version: true,
          status: true,
          sentAt: true,
          sentSnapshot: true,
          createdAt: true,
          obraItems: {
            orderBy: [{ sortOrder: "asc" }],
            select: {
              id: true,
              itemNumber: true,
              name: true,
              quantity: true,
              unit: true,
              unitPrice: true,
              total: true,
              components: {
                select: {
                  id: true,
                  type: true,
                  unit: true,
                  quantity: true,
                  unitCost: true,
                  totalCost: true,
                  appliedToComponentId: true,
                  appliedToType: true,
                },
              },
            },
          },
        },
      },
    },
  });

  // ---- Resumen global ----
  let totVersiones = 0;
  let totPartidasConDesglose = 0;
  let totPartidasEnBruto = 0;
  let totDescuadradas = 0;
  let sumAbsDescuadre = 0;

  type FilaVersion = {
    proyecto: string;
    version: string;
    status: string;
    sent: boolean;
    nPartidas: number;
    enBruto: number;
    descuadradas: Array<{
      item: string;
      nombre: string;
      qty: number;
      unit: string;
      puEncabezado: number;
      puDesglose: number;
      diffPU: number;
      diffTotal: number;
    }>;
  };
  const filas: FilaVersion[] = [];

  for (const p of projects) {
    if (filtro && !p.name.toLowerCase().includes(filtro)) continue;
    for (const v of p.budgetVersions) {
      totVersiones++;
      const fila: FilaVersion = {
        proyecto: p.name,
        version: v.version,
        status: v.status,
        sent: !!v.sentSnapshot,
        nPartidas: v.obraItems.length,
        enBruto: 0,
        descuadradas: [],
      };
      for (const it of v.obraItems) {
        if (it.components.length === 0) {
          totPartidasEnBruto++;
          fila.enBruto++;
          continue;
        }
        totPartidasConDesglose++;
        const comps = it.components as Comp[];
        const puDesglose = comps.reduce(
          (s, c) => s + effectiveTotal(c, comps),
          0
        );
        const puEnc = it.unitPrice || 0;
        const diffPU = puEnc - puDesglose;
        if (Math.abs(diffPU) > TOL) {
          totDescuadradas++;
          sumAbsDescuadre += Math.abs(diffPU * (it.quantity || 0));
          fila.descuadradas.push({
            item: it.itemNumber,
            nombre: it.name,
            qty: it.quantity || 0,
            unit: it.unit,
            puEncabezado: puEnc,
            puDesglose,
            diffPU,
            diffTotal: diffPU * (it.quantity || 0),
          });
        }
      }
      filas.push(fila);
    }
  }

  // ---- Salida: detalle de Depto Colon primero, luego resumen global ----
  const colon = filas.filter((f) =>
    f.proyecto.toLowerCase().includes("colon")
  );

  if (colon.length) {
    console.log("\n========================================================");
    console.log("  DEPTO COLON (Constanza) — detalle por versión");
    console.log("========================================================");
    for (const f of colon) {
      const desc = f.descuadradas.length;
      console.log(
        `\n• ${f.proyecto} — ${f.version}  [${f.status}${
          f.sent ? " · congelada (con foto)" : ""
        }]`
      );
      console.log(
        `    ${f.nPartidas} partidas · ${f.enBruto} en bruto (sin desglose) · ${desc} descuadradas`
      );
      if (desc) {
        for (const d of f.descuadradas) {
          const signo = d.diffPU > 0 ? "encabezado MAYOR" : "encabezado MENOR";
          console.log(
            `      ${d.item} ${d.nombre}`
          );
          console.log(
            `         encabezado ${clp(d.puEncabezado)}  vs  desglose ${clp(
              d.puDesglose
            )}   (Δ P.U. ${clp(d.diffPU)} — ${signo}; Δ total ${clp(
              d.diffTotal
            )}, qty ${d.qty} ${d.unit})`
          );
        }
      }
    }
  } else {
    console.log("\n(No se encontró ningún proyecto con 'colon' en el nombre)");
  }

  // ---- Resumen global de todos los proyectos ----
  console.log("\n\n========================================================");
  console.log("  RESUMEN GLOBAL (todos los proyectos de obra)");
  console.log("========================================================");
  console.log(`  Versiones de obra revisadas: ${totVersiones}`);
  console.log(`  Partidas con desglose:       ${totPartidasConDesglose}`);
  console.log(`  Partidas en bruto (sin desglose): ${totPartidasEnBruto}`);
  console.log(`  Partidas DESCUADRADAS:       ${totDescuadradas}`);
  console.log(
    `  Suma |Δ total| de descuadres: ${clp(sumAbsDescuadre)}`
  );

  console.log("\n  --- Versiones con al menos 1 descuadre ---");
  const conDescuadre = filas
    .filter((f) => f.descuadradas.length > 0)
    .sort((a, b) => b.descuadradas.length - a.descuadradas.length);
  for (const f of conDescuadre) {
    const sumV = f.descuadradas.reduce((s, d) => s + Math.abs(d.diffTotal), 0);
    console.log(
      `   ${f.descuadradas.length.toString().padStart(3)} descuadradas  |Δ| ${clp(
        sumV
      ).padStart(14)}  —  ${f.proyecto} ${f.version} [${f.status}${
        f.sent ? "·congelada" : ""
      }]`
    );
  }
  if (!conDescuadre.length) console.log("   (ninguna)");

  console.log("");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
