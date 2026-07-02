// Verificación A5: compara las alertas de la pantalla de Resumen ANTES
// (lógica que vivía en resumen/page.tsx) vs DESPUÉS (m.alerts de metrics.ts).
// Debe dar IDÉNTICO por proyecto. Además reporta si en la lógica vieja de
// metrics.ts existía la alerta "Sin EP" (que NO se mostraba y ahora ya no
// se genera).
//
// Uso: DOTENV_CONFIG_PATH=.env.prod npx tsx scripts/diag-a5-alertas.ts
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  computeProjectMetrics,
  PROJECT_METRICS_INCLUDE,
  type ProjectWithMetrics,
} from "../src/lib/projects/metrics";
import { formatCLP } from "../src/lib/utils";

// Réplica EXACTA de la lógica de alertas que vivía en resumen/page.tsx antes
// del dedup (obra + muebles + artefactos con su costeo + vencidas con monto).
function legacyPageAlertas(p: ProjectWithMetrics): string[] {
  const m = computeProjectMetrics(p);
  const { budgetByType, realByCategory: realByTop, realBySpecific } = m;

  function bestVersion<T extends { status: string; createdAt: Date }>(arr: T[]) {
    const ap = arr.filter((b) => b.status === "aprobado").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return ap ?? arr.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  }
  const lastMuebles = bestVersion(p.budgetVersions.filter((b) => b.type === "muebles"));
  const lastArtefactos = bestVersion(p.budgetVersions.filter((b) => b.type === "artefactos"));
  const mueblesAllItems = lastMuebles ? lastMuebles.muebleChapters.flatMap((c) => c.items) : [];

  type Row = { label: string; presupuesto: number; real: number };
  const obraRows: Row[] = [
    { label: "Materiales", presupuesto: budgetByType.costMaterial, real: realByTop["Materiales"] || 0 },
    { label: "Mano de obra", presupuesto: budgetByType.costLabor, real: realByTop["Mano de obra"] || 0 },
    { label: "Herramientas", presupuesto: budgetByType.costTools, real: realByTop["Herramientas"] || 0 },
    { label: "Subcontrato", presupuesto: budgetByType.costSubcontract, real: realByTop["Subcontrato"] || 0 },
    { label: "Pérdidas", presupuesto: budgetByType.costLoss, real: realByTop["Pérdidas"] || 0 },
    { label: "Margen", presupuesto: budgetByType.costMargin, real: 0 },
  ];
  function muebleNameToSub(name: string): "Mueble" | "Herrajes" | "Cubiertas" {
    const u = (name || "").toUpperCase();
    if (u.includes("CUBIERTA")) return "Cubiertas";
    if (u.includes("HERRAJ")) return "Herrajes";
    return "Mueble";
  }
  const mp = { Mueble: 0, Herrajes: 0, Cubiertas: 0 };
  for (const it of mueblesAllItems) {
    const c = it.costDistributor > 0 ? it.costDistributor : it.clientPriceNet > 0 ? it.clientPriceNet : it.clientPriceIva / 1.19;
    mp[muebleNameToSub(it.name)] += c * it.quantity;
  }
  const realMuebleTopSinSub = realBySpecific["Muebles"] || 0;
  const mueblesRows: Row[] = [
    { label: "Mueble", presupuesto: mp.Mueble, real: (realBySpecific["Mueble"] || 0) + realMuebleTopSinSub },
    { label: "Herrajes", presupuesto: mp.Herrajes, real: realBySpecific["Herrajes"] || 0 },
    { label: "Cubiertas", presupuesto: mp.Cubiertas, real: realBySpecific["Cubiertas"] || 0 },
  ];
  function artefactoSubToCat(sub: string): "Cocina" | "Baño" | "Iluminación" {
    if (sub === "iluminacion") return "Iluminación";
    if (sub === "sanitario") return "Baño";
    return "Cocina";
  }
  const ap = { Cocina: 0, Baño: 0, Iluminación: 0 };
  if (lastArtefactos) {
    for (const it of lastArtefactos.artefactoItems) {
      const c = it.realCostBlarq && it.realCostBlarq > 0 ? it.realCostBlarq : (it.clientPrice ?? 0) / 1.19;
      ap[artefactoSubToCat(it.subcategory)] += c;
    }
  }
  const artefactosRows: Row[] = [
    { label: "Cocina", presupuesto: ap.Cocina, real: realBySpecific["Cocina"] || 0 },
    { label: "Baño", presupuesto: ap.Baño, real: realBySpecific["Baño"] || 0 },
    { label: "Iluminación", presupuesto: ap.Iluminación, real: realBySpecific["Iluminación"] || 0 },
  ];

  const alertas: string[] = [];
  for (const rows of [obraRows, mueblesRows, artefactosRows]) {
    for (const r of rows) {
      if (r.presupuesto === 0) continue;
      const pct = (r.real / r.presupuesto) * 100;
      if (pct >= 100) alertas.push(`[danger] ${r.label}: ${pct.toFixed(0)}% del presupuesto consumido (excedido)`);
      else if (pct >= 80) alertas.push(`[warning] ${r.label}: ${pct.toFixed(0)}% del presupuesto consumido`);
    }
  }
  const now = new Date();
  const facturasRecibidas = p.invoices.filter((i) => i.type === "recibida");
  const vencidas = facturasRecibidas.filter((i) => i.status === "pendiente" && i.dueDate && i.dueDate < now);
  if (vencidas.length > 0) {
    const monto = vencidas.reduce((s, i) => s + i.totalAmount, 0);
    alertas.push(`[danger] ${vencidas.length} factura${vencidas.length > 1 ? "s" : ""} vencida${vencidas.length > 1 ? "s" : ""} pendiente${vencidas.length > 1 ? "s" : ""} de pago — ${formatCLP(monto)}`);
  }
  return alertas;
}

async function main() {
  const projects = await prisma.project.findMany({
    where: { isInternal: false },
    include: PROJECT_METRICS_INCLUDE,
    orderBy: { name: "asc" },
  });

  let diffs = 0;
  let conAlertas = 0;
  let sinEPencontradas = 0;
  const conAlertasNombres: string[] = [];

  for (const p of projects) {
    const before = legacyPageAlertas(p as ProjectWithMetrics);
    const after = computeProjectMetrics(p as ProjectWithMetrics).alerts.map(
      (a) => `[${a.severity}] ${a.message}`
    );
    // ¿aparece "Sin EP" en el nuevo?
    const sinEP = after.filter((a) => a.includes("Sin EP") || a.includes("Sin EPs"));
    if (sinEP.length > 0) sinEPencontradas += sinEP.length;

    if (before.length > 0 || after.length > 0) {
      conAlertas++;
      conAlertasNombres.push(p.name);
    }
    const igual = before.length === after.length && before.every((b, i) => b === after[i]);
    if (!igual) {
      diffs++;
      console.log(`\n### DIFF en ${p.name}`);
      console.log("  ANTES:", JSON.stringify(before, null, 2));
      console.log("  DESPUÉS:", JSON.stringify(after, null, 2));
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Proyectos no-internos:            ${projects.length}`);
  console.log(`Con alertas (antes o después):    ${conAlertas}`);
  console.log(`Con DIFERENCIAS antes/después:    ${diffs}`);
  console.log(`Alertas "Sin EP" en el nuevo:     ${sinEPencontradas}`);
  console.log("=".repeat(60));
  if (diffs === 0) console.log("OK — las alertas de la pantalla de Resumen son IDÉNTICAS al dedup.");
  console.log("\nProyectos con alertas:", conAlertasNombres.join(" · "));

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
