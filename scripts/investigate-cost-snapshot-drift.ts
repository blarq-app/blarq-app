import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import type { ObraItemComponent } from "@prisma/client";

// Réplica idéntica de la lógica de src/lib/catalog/recalcObraItem.ts.
// Si esta diverge, hay que actualizar las dos a la par.
function effectiveTotal(
  comp: ObraItemComponent,
  all: ObraItemComponent[]
): number {
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
      .filter(
        (c) => c.type === "mano_obra" && c.unit !== "%" && c.id !== comp.id
      )
      .reduce((s, c) => s + effectiveTotal(c, all), 0);
    return moBase * (pct / 100);
  }
  if (comp.type === "margen") {
    const base = all
      .filter(
        (c) =>
          c.id !== comp.id && c.type !== "margen" && c.type !== "perdida"
      )
      .reduce((s, c) => s + effectiveTotal(c, all), 0);
    return base * (pct / 100);
  }
  return (comp.quantity || 0) * (comp.unitCost || 0);
}

const TYPE_TO_FIELD: Record<
  string,
  "costMaterial" | "costLabor" | "costTools" | "costSubcontract" | "costLoss" | "costMargin"
> = {
  material: "costMaterial",
  mano_obra: "costLabor",
  herramientas: "costTools",
  subcontrato: "costSubcontract",
  perdida: "costLoss",
  margen: "costMargin",
};

async function main() {
  const filter = process.argv[2]; // opcional: nombre de proyecto a filtrar

  const budgets = await prisma.budgetVersion.findMany({
    where: { type: "obra" },
    include: {
      project: { select: { id: true, name: true, isInternal: true } },
      obraItems: {
        orderBy: { sortOrder: "asc" },
        include: { components: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  type ItemSummary = {
    project: string;
    budget: string;
    itemNumber: string;
    itemName: string;
    itemQty: number;
    snap: number; // suma cost* (por unidad) × qty
    compSnap: number; // suma c.totalCost (por unidad) × qty
    compEff: number; // suma effectiveTotal(c) (por unidad) × qty
    components: number;
  };

  const rows: ItemSummary[] = [];

  for (const b of budgets) {
    if (b.project.isInternal) continue;
    if (filter && !b.project.name.toLowerCase().includes(filter.toLowerCase()))
      continue;

    for (const it of b.obraItems) {
      const comps = it.components;
      if (comps.length === 0) continue;

      // Snapshot del item: por unidad sumando los 6 campos cost*. Si todos
      // son null, asumimos snapshot vacío (drift completo).
      const snapUnit =
        (it.costMaterial ?? 0) +
        (it.costLabor ?? 0) +
        (it.costTools ?? 0) +
        (it.costSubcontract ?? 0) +
        (it.costLoss ?? 0) +
        (it.costMargin ?? 0);

      const compSnapUnit = comps.reduce((s, c) => s + (c.totalCost ?? 0), 0);
      const compEffUnit = comps.reduce(
        (s, c) => s + effectiveTotal(c, comps),
        0
      );

      const qty = it.quantity ?? 0;

      rows.push({
        project: b.project.name,
        budget: `${b.version} (${b.status})`,
        itemNumber: it.itemNumber,
        itemName: it.name,
        itemQty: qty,
        snap: snapUnit * qty,
        compSnap: compSnapUnit * qty,
        compEff: compEffUnit * qty,
        components: comps.length,
      });
    }
  }

  // Agregar por proyecto+budget
  const groups = new Map<
    string,
    {
      project: string;
      budget: string;
      items: number;
      itemsWithDrift: number;
      snapTotal: number;
      compSnapTotal: number;
      compEffTotal: number;
    }
  >();

  for (const r of rows) {
    const key = `${r.project} :: ${r.budget}`;
    const g = groups.get(key) ?? {
      project: r.project,
      budget: r.budget,
      items: 0,
      itemsWithDrift: 0,
      snapTotal: 0,
      compSnapTotal: 0,
      compEffTotal: 0,
    };
    g.items += 1;
    g.snapTotal += r.snap;
    g.compSnapTotal += r.compSnap;
    g.compEffTotal += r.compEff;
    if (Math.abs(r.snap - r.compEff) > 1) g.itemsWithDrift += 1;
    groups.set(key, g);
  }

  console.log("=".repeat(120));
  console.log("DRIFT por presupuesto");
  console.log("=".repeat(120));
  console.log(
    `${"proyecto :: budget".padEnd(50)}  items  drift  snap_total      comp_snap        comp_eff         diff_snap   diff_eff`
  );
  for (const g of Array.from(groups.values()).sort(
    (a, b) =>
      Math.abs(b.compEffTotal - b.snapTotal) -
      Math.abs(a.compEffTotal - a.snapTotal)
  )) {
    const dSnap = g.compSnapTotal - g.snapTotal;
    const dEff = g.compEffTotal - g.snapTotal;
    console.log(
      `${`${g.project} :: ${g.budget}`.slice(0, 48).padEnd(50)}  ${String(g.items).padStart(3)}  ${String(g.itemsWithDrift).padStart(4)}  ${g.snapTotal.toLocaleString("es-CL").padStart(14)}  ${g.compSnapTotal.toLocaleString("es-CL").padStart(14)}  ${g.compEffTotal.toLocaleString("es-CL").padStart(14)}  ${dSnap.toLocaleString("es-CL").padStart(10)}  ${dEff.toLocaleString("es-CL").padStart(10)}`
    );
  }

  // Detalle del peor presupuesto (top 5 items con drift)
  console.log("\n" + "=".repeat(120));
  console.log("DETALLE — top 10 items con mayor drift (todos los presupuestos)");
  console.log("=".repeat(120));
  console.log(
    `${"proyecto".padEnd(20)}  ${"item".padEnd(8)}  ${"nombre".padEnd(40)}  qty  ${"snap".padStart(12)}  ${"comp_eff".padStart(12)}  ${"diff".padStart(12)}`
  );
  const sorted = [...rows].sort(
    (a, b) => Math.abs(b.compEff - b.snap) - Math.abs(a.compEff - a.snap)
  );
  for (const r of sorted.slice(0, 10)) {
    const diff = r.compEff - r.snap;
    console.log(
      `${r.project.slice(0, 20).padEnd(20)}  ${r.itemNumber.padEnd(8)}  ${r.itemName.slice(0, 40).padEnd(40)}  ${String(r.itemQty).padStart(3)}  ${Math.round(r.snap).toLocaleString("es-CL").padStart(12)}  ${Math.round(r.compEff).toLocaleString("es-CL").padStart(12)}  ${Math.round(diff).toLocaleString("es-CL").padStart(12)}`
    );
  }

  // Para el filtro específico, mostrar detalle por tipo del item con más drift
  if (filter) {
    const top = sorted[0];
    if (top) {
      console.log("\n" + "=".repeat(120));
      console.log(`DETALLE POR TIPO — item con más drift: ${top.itemNumber} ${top.itemName}`);
      console.log("=".repeat(120));
      const b = budgets
        .filter((x) => x.project.name === top.project)
        .find((x) => x.obraItems.some((i) => i.itemNumber === top.itemNumber));
      const it = b?.obraItems.find((i) => i.itemNumber === top.itemNumber);
      if (it) {
        const comps = it.components;
        for (const type of Object.keys(TYPE_TO_FIELD)) {
          const field = TYPE_TO_FIELD[type];
          const snapUnit = (it as Record<string, unknown>)[field] as number | null;
          const compSnapUnit = comps
            .filter((c) => c.type === type)
            .reduce((s, c) => s + (c.totalCost ?? 0), 0);
          const compEffUnit = comps
            .filter((c) => c.type === type)
            .reduce((s, c) => s + effectiveTotal(c, comps), 0);
          if (snapUnit || compSnapUnit || compEffUnit) {
            console.log(
              `  ${type.padEnd(13)}  snap_unit=${String(Math.round(snapUnit ?? 0)).padStart(10)}  comp_snap_unit=${String(Math.round(compSnapUnit)).padStart(10)}  comp_eff_unit=${String(Math.round(compEffUnit)).padStart(10)}`
            );
          }
        }
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
