/**
 * PASO 0b — Diagnóstico SOLO LECTURA enfocado en BORRADORES.
 *
 * Para cada versión en estado borrador muestra el efecto que tendría la "regla
 * única" (el total al cliente sale SIEMPRE del desglose):
 *   - precio actual de la cotización (suma de los `total` guardados, encabezado)
 *   - precio si saliera del desglose (Σ desglose × qty por partida)
 *   - la diferencia → cuánto se MOVERÍA el precio al cliente al aplicar el Paso 1
 *   - partidas "en bruto" (sin desglose): no cambian (sembrar = total idéntico)
 *   - partidas descuadradas (con desglose): se listan con su Δ
 *
 * No escribe NADA.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TOL = 1;

type Comp = {
  id: string; type: string; unit: string; quantity: number;
  unitCost: number; totalCost: number;
  appliedToComponentId: string | null; appliedToType: string | null;
};

function effectiveTotal(comp: Comp, all: Comp[]): number {
  const pct = comp.quantity || 0;
  if (comp.unit !== "%") return (comp.quantity || 0) * (comp.unitCost || 0);
  if (comp.type === "perdida" && comp.appliedToComponentId) {
    const t = all.find((c) => c.id === comp.appliedToComponentId);
    if (!t) return 0;
    return effectiveTotal(t, all) * (pct / 100);
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

const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  // Panorama: todos los borradores de cualquier tipo
  const todos = await prisma.budgetVersion.findMany({
    where: { status: "borrador" },
    select: { id: true, version: true, type: true, project: { select: { name: true } } },
    orderBy: { project: { name: "asc" } },
  });
  console.log("\n=== TODOS LOS BORRADORES (cualquier tipo) ===");
  for (const v of todos) {
    console.log(`  [${v.type}] ${v.project.name} — ${v.version}`);
  }

  // Detalle solo de obra (el desglose vive en ObraItemComponent)
  const versiones = await prisma.budgetVersion.findMany({
    where: { status: "borrador", type: "obra" },
    select: {
      id: true, version: true,
      project: { select: { name: true } },
      obraItems: {
        orderBy: [{ sortOrder: "asc" }],
        select: {
          id: true, itemNumber: true, name: true, quantity: true, unit: true,
          unitPrice: true, total: true,
          components: {
            select: {
              id: true, type: true, unit: true, quantity: true, unitCost: true,
              totalCost: true, appliedToComponentId: true, appliedToType: true,
            },
          },
        },
      },
    },
  });

  console.log("\n\n========================================================");
  console.log("  EFECTO DEL PASO 1 EN BORRADORES DE OBRA");
  console.log("  (el total al cliente pasaría a salir del desglose)");
  console.log("========================================================");

  for (const v of versiones) {
    let totalHeader = 0;     // precio actual (encabezado)
    let totalDesglose = 0;   // precio si sale del desglose
    let enBruto = 0;
    const desc: Array<{
      item: string; nombre: string; qty: number; unit: string;
      headerTotal: number; desgloseTotal: number; diff: number; sinDesglose: boolean;
    }> = [];

    for (const it of v.obraItems) {
      const headerTotal = it.total || 0;
      totalHeader += headerTotal;
      if (it.components.length === 0) {
        enBruto++;
        totalDesglose += headerTotal; // sembrar = total idéntico, no cambia
        continue;
      }
      const comps = it.components as Comp[];
      const puDesg = comps.reduce((s, c) => s + effectiveTotal(c, comps), 0);
      const desgloseTotal = puDesg * (it.quantity || 0);
      totalDesglose += desgloseTotal;
      const diff = desgloseTotal - headerTotal; // cuánto cambia el precio de esta partida
      if (Math.abs(diff) > TOL) {
        desc.push({
          item: it.itemNumber, nombre: it.name, qty: it.quantity || 0, unit: it.unit,
          headerTotal, desgloseTotal, diff, sinDesglose: false,
        });
      }
    }

    const deltaVersion = totalDesglose - totalHeader;
    console.log(`\n• ${v.project.name} — ${v.version}`);
    console.log(`    ${v.obraItems.length} partidas · ${enBruto} en bruto (no cambian) · ${desc.length} descuadradas`);
    console.log(`    Precio actual (encabezado): ${clp(totalHeader)}`);
    console.log(`    Precio si sale del desglose: ${clp(totalDesglose)}`);
    console.log(`    >>> El precio al cliente se MOVERÍA ${clp(deltaVersion)} (${deltaVersion >= 0 ? "+" : ""}${((deltaVersion / (totalHeader || 1)) * 100).toFixed(1)}%)`);
    if (desc.length) {
      // ordenar por magnitud del cambio
      desc.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
      for (const d of desc) {
        console.log(
          `      ${d.item} ${d.nombre}: ${clp(d.headerTotal)} → ${clp(d.desgloseTotal)}  (${d.diff >= 0 ? "+" : ""}${clp(d.diff)})`
        );
      }
    }
  }
  console.log("");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
