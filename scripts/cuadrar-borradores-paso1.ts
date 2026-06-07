import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  recalcObraItemFromComponents,
  seedObraItemComponentsFromLumps,
} from "../src/lib/catalog/recalcObraItem";
import { writeFileSync } from "fs";

/**
 * PASO 1 — "Cuadrar todo" en cotizaciones de obra en BORRADOR.
 *
 * Regla única: el total al cliente sale SIEMPRE del desglose.
 *   1. Partidas "en bruto" (sin componentes): se SIEMBRA el desglose desde los
 *      montos globales (seedObraItemComponentsFromLumps) y se recalcula. El total
 *      queda idéntico SALVO cuando el P.U. guardado ya no coincidía con la suma de
 *      los costos internos (entonces el desglose manda → el precio se mueve).
 *   2. Partidas con desglose pero descuadradas: se recalcula el encabezado desde
 *      el desglose (recalcObraItemFromComponents).
 *
 * Candados:
 *   - SOLO versiones status="borrador" y type="obra".
 *   - EXCLUYE Portofino (decisión MJ: proyecto viejo, no tocar).
 *   - Dry-run por defecto; --apply para escribir. Backup completo previo.
 *   - No toca enviadas/aprobadas (esas están protegidas y son la verdad al cliente).
 *
 * Nota contable (§4.1): metrics.ts usa obraItems.total/costLabor de la versión
 * aprobada o, si no hay, la última por fecha. Paseo del Sena y Cocina Candelaria 2
 * no tienen aprobada → su borrador alimenta el lado PRESUPUESTO (costo directo,
 * GG, utilidad proyectada). El lado REAL (cobrado/gastado/utilidad real) sale de
 * facturas y NO se mueve. Correr snapshot-metrics.ts pre/post.
 */

const APPLY = process.argv.includes("--apply");
const EXCLUIR = "portofino";

function host() {
  const m = (process.env.DATABASE_URL || "").match(/@([^/.]+)/);
  return m ? m[1] : "desconocido";
}
const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

// Espejo EXACTO de effectiveTotal en recalcObraItem.ts (para SIMULAR en dry-run
// sin escribir). En --apply no se usa para escribir: ahí mandan las funciones reales.
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

async function main() {
  console.log(`Host: ${host()}  —  modo: ${APPLY ? "APPLY (escribe)" : "DRY-RUN (no escribe)"}\n`);

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
          costMaterial: true, costLabor: true, costTools: true,
          costSubcontract: true, costLoss: true, costMargin: true,
          components: {
            select: {
              id: true, type: true, unit: true, quantity: true, unitCost: true,
              totalCost: true, appliedToComponentId: true, appliedToType: true,
              description: true, materialId: true, originComponentId: true,
              isCustomized: true, sortOrder: true, referenceLink: true,
            },
          },
        },
      },
    },
  });

  const objetivo = versiones.filter(
    (v) => !v.project.name.toLowerCase().includes(EXCLUIR)
  );
  const excluidas = versiones.filter((v) =>
    v.project.name.toLowerCase().includes(EXCLUIR)
  );
  if (excluidas.length) {
    console.log(`EXCLUIDAS (no se tocan): ${excluidas.map((v) => `${v.project.name} ${v.version}`).join(", ")}\n`);
  }

  // Backup completo previo (reversible)
  if (APPLY) {
    const stamp = process.env.STAMP || "manual";
    const backupPath = `/Users/mjblanco/Desktop/blarq-app/backups/cuadrar-borradores-paso1-${stamp}.json`;
    writeFileSync(backupPath, JSON.stringify(objetivo, null, 2));
    console.log(`Backup: ${backupPath}\n`);
  }

  // Plan de acciones por partida (simulado primero, para mostrar)
  type Accion = {
    vIdx: number; itemId: string; itemNumber: string; nombre: string;
    qty: number; accion: "sembrar" | "recalcular" | "sembrar(vacío)";
    totalAntes: number; totalDespSim: number;
  };
  const acciones: Accion[] = [];

  objetivo.forEach((v, vIdx) => {
    for (const it of v.obraItems) {
      const totalAntes = it.total || 0;
      if (it.components.length === 0) {
        // EN BRUTO: simular sembrado = Σ cost* (margen reconstruido = costMargin)
        const sumCost =
          (it.costMaterial ?? 0) + (it.costLabor ?? 0) + (it.costTools ?? 0) +
          (it.costSubcontract ?? 0) + (it.costLoss ?? 0) + (it.costMargin ?? 0);
        const seSiembra = sumCost !== 0; // seed ignora lumps en cero
        const totalDespSim = seSiembra ? sumCost * (it.quantity ?? 0) : totalAntes;
        acciones.push({
          vIdx, itemId: it.id, itemNumber: it.itemNumber, nombre: it.name,
          qty: it.quantity ?? 0,
          accion: seSiembra ? "sembrar" : "sembrar(vacío)",
          totalAntes, totalDespSim,
        });
      } else {
        const comps = it.components as Comp[];
        const puDesg = comps.reduce((s, c) => s + effectiveTotal(c, comps), 0);
        const totalDespSim = puDesg * (it.quantity ?? 0);
        acciones.push({
          vIdx, itemId: it.id, itemNumber: it.itemNumber, nombre: it.name,
          qty: it.quantity ?? 0, accion: "recalcular",
          totalAntes, totalDespSim,
        });
      }
    }
  });

  // Reporte por versión (foto pre/post simulada)
  console.log("======== EFECTO SIMULADO (foto pre/post) ========");
  objetivo.forEach((v, vIdx) => {
    const accV = acciones.filter((a) => a.vIdx === vIdx);
    const tAntes = accV.reduce((s, a) => s + a.totalAntes, 0);
    const tDesp = accV.reduce((s, a) => s + a.totalDespSim, 0);
    const sembradas = accV.filter((a) => a.accion === "sembrar").length;
    const vacias = accV.filter((a) => a.accion === "sembrar(vacío)").length;
    const recalc = accV.filter((a) => a.accion === "recalcular").length;
    console.log(`\n• ${v.project.name} — ${v.version}`);
    console.log(`    ${accV.length} partidas · ${sembradas} a sembrar · ${vacias} en bruto vacías (sin efecto) · ${recalc} con desglose`);
    console.log(`    Precio: ${clp(tAntes)} → ${clp(tDesp)}  (Δ ${clp(tDesp - tAntes)})`);
    const cambian = accV.filter((a) => Math.abs(a.totalDespSim - a.totalAntes) > 1);
    for (const a of cambian.sort((x, y) => Math.abs(y.totalDespSim - y.totalAntes) - Math.abs(x.totalDespSim - x.totalAntes))) {
      console.log(`      ${a.itemNumber} ${a.nombre}: ${clp(a.totalAntes)} → ${clp(a.totalDespSim)}  (${a.totalDespSim - a.totalAntes >= 0 ? "+" : ""}${clp(a.totalDespSim - a.totalAntes)})  [${a.accion}]`);
    }
  });

  if (!APPLY) {
    console.log("\n\nDRY-RUN: no se escribió nada. Para aplicar: --apply (con OK de MJ).");
    return;
  }

  // ---- APLICAR ----
  console.log("\n\n======== APLICANDO ========");
  let sembradas = 0, recalculadas = 0;
  for (const a of acciones) {
    if (a.accion === "sembrar" || a.accion === "sembrar(vacío)") {
      const did = await seedObraItemComponentsFromLumps(a.itemId);
      if (did) { sembradas++; await recalcObraItemFromComponents(a.itemId); }
    } else {
      await recalcObraItemFromComponents(a.itemId);
      recalculadas++;
    }
  }
  console.log(`Sembradas: ${sembradas} · Recalculadas: ${recalculadas}`);

  // Verificación post real vs simulado
  console.log("\n======== VERIFICACIÓN POST (real) ========");
  let descuadres = 0;
  for (const a of acciones) {
    const post = await prisma.obraItem.findUniqueOrThrow({
      where: { id: a.itemId }, select: { total: true },
    });
    const diff = Math.abs((post.total ?? 0) - a.totalDespSim);
    if (diff > 1) {
      descuadres++;
      console.log(`  ⚠ ${a.itemNumber} ${a.nombre}: real ${clp(post.total ?? 0)} ≠ simulado ${clp(a.totalDespSim)} (Δ ${clp(diff)})`);
    }
  }
  console.log(descuadres === 0 ? "OK — real coincide con lo simulado en todas las partidas." : `⚠ ${descuadres} partidas no coinciden con la simulación (revisar).`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
