// Diagnóstico (READ-ONLY) de la V3 de obra de Paseo del Sena (#64) — pendiente 174.
//
// El 2026-09-03 el botón "Volver a lo enviado" restauró la V3 a la foto del
// 7-ago, tres días ANTES del PDF que MJ le mandó a la clienta (10-ago 11:16).
// Este script NO escribe nada: compara V3 vs V4 y deja el panorama para
// decidir la reparación.
//
// Se conecta a la VIVA leyendo la URL de un archivo local (nunca del chat) y
// pasándola como datasourceUrl explícito: así ni dotenv ni el auto-load de
// Prisma pueden desviarlo a la base vieja (ep-solitary-mud).
//
//   npx tsx scripts/diag-174-sena-v3-reparar.ts

import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

function urlViva(): string {
  const raw = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8");
  const m = raw.match(/^DATABASE_URL=["']?(.+?)["']?$/m);
  if (!m) throw new Error("No encontré DATABASE_URL en .env.prod");
  const url = m[1];
  if (!/ep-shy-morning/.test(url)) {
    throw new Error("ABORTO: la URL de .env.prod NO apunta a ep-shy-morning (la viva)");
  }
  return url;
}

const prisma = new PrismaClient({ datasourceUrl: urlViva() });

const money = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  // Marcador de base viva (§4.9): #64 debe ser Paseo del Sena.
  const p = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { id: true, numeroProyecto: true, name: true },
  });
  console.log("BASE: ep-shy-morning (VIVA)");
  console.log("Marcador #64 =", p?.name);
  if (!p || !/sena/i.test(p.name)) throw new Error("ABORTO: #64 no es Paseo del Sena");

  const versiones = await prisma.budgetVersion.findMany({
    where: { projectId: p.id, type: "obra" },
    select: {
      id: true, version: true, status: true, date: true, createdAt: true,
      updatedAt: true, parentVersionId: true, ggPercentage: true,
      utilityPercentage: true, sentAt: true,
      _count: { select: { obraItems: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log("\n=== VERSIONES DE OBRA DE SENA ===");
  for (const v of versiones) {
    const snap = await prisma.budgetVersion.findUnique({
      where: { id: v.id }, select: { sentSnapshot: true },
    });
    const items = await prisma.obraItem.findMany({
      where: { budgetVersionId: v.id },
      select: { total: true, noCobrado: true },
    });
    const directo = items.filter((i) => !i.noCobrado).reduce((s, i) => s + i.total, 0);
    const gg = directo * ((v.ggPercentage ?? 0) / 100);
    const ut = directo * ((v.utilityPercentage ?? 0) / 100);
    const neto = directo + gg + ut;
    console.log(
      `${v.version.padEnd(4)} ${v.status.padEnd(9)} id=${v.id}` +
        `\n     partidas=${v._count.obraItems} (noCobrado=${items.filter((i) => i.noCobrado).length})` +
        ` gg=${v.ggPercentage}% ut=${v.utilityPercentage}%` +
        `\n     directo=${money(directo)} neto=${money(neto)} total c/IVA=${money(neto * 1.19)}` +
        `\n     createdAt=${v.createdAt.toISOString()} updatedAt=${v.updatedAt.toISOString()}` +
        ` sentAt=${v.sentAt?.toISOString() ?? "-"} snapshot=${snap?.sentSnapshot ? "SI" : "no"}` +
        ` parent=${v.parentVersionId ?? "-"}`
    );
  }

  const v3 = versiones.find((v) => v.version === "V3");
  const v4 = versiones.find((v) => v.version === "V4");
  if (!v3 || !v4) throw new Error("No encontré V3 y/o V4");

  const sel = {
    id: true, lineageId: true, itemNumber: true, name: true, unit: true,
    quantity: true, unitPrice: true, total: true, noCobrado: true,
    maestroId: true, descriptionCliente: true, descriptionMaestro: true,
    chapterId: true, subChapter: true, sortOrder: true,
    costMaterial: true, costLabor: true, costSubcontract: true,
    costMargin: true, costTools: true, costLoss: true,
  } as const;

  const it3 = await prisma.obraItem.findMany({
    where: { budgetVersionId: v3.id }, select: sel, orderBy: { sortOrder: "asc" },
  });
  const it4 = await prisma.obraItem.findMany({
    where: { budgetVersionId: v4.id }, select: sel, orderBy: { sortOrder: "asc" },
  });

  const maestros = await prisma.maestro.findMany({ select: { id: true, name: true } });
  const nomMaestro = (id: string | null) =>
    id ? (maestros.find((m) => m.id === id)?.name ?? id) : "—";

  const por4 = new Map(it4.map((i) => [i.lineageId, i]));
  const por3 = new Map(it3.map((i) => [i.lineageId, i]));

  console.log("\n=== DIFERENCIAS V3 (hoy) vs V4 (buena), por lineageId ===");
  let dif = 0;
  for (const a of it3) {
    const b = por4.get(a.lineageId);
    if (!b) { console.log(`SOLO EN V3: ${a.itemNumber} ${a.name}`); dif++; continue; }
    const campos: string[] = [];
    if (a.quantity !== b.quantity) campos.push(`quantity ${a.quantity} -> ${b.quantity}`);
    if (Math.abs(a.unitPrice - b.unitPrice) > 0.01) campos.push(`unitPrice ${a.unitPrice} -> ${b.unitPrice}`);
    if (Math.abs(a.total - b.total) > 0.5) campos.push(`total ${money(a.total)} -> ${money(b.total)}`);
    if (a.noCobrado !== b.noCobrado) campos.push(`noCobrado ${a.noCobrado} -> ${b.noCobrado}`);
    if (a.maestroId !== b.maestroId) campos.push(`maestro ${nomMaestro(a.maestroId)} -> ${nomMaestro(b.maestroId)}`);
    if ((a.descriptionCliente ?? "") !== (b.descriptionCliente ?? "")) campos.push(`descCliente [${a.descriptionCliente ?? ""}] -> [${b.descriptionCliente ?? ""}]`);
    if ((a.descriptionMaestro ?? "") !== (b.descriptionMaestro ?? "")) campos.push(`descMaestro [${a.descriptionMaestro ?? ""}] -> [${b.descriptionMaestro ?? ""}]`);
    if (a.unit !== b.unit) campos.push(`unit ${a.unit} -> ${b.unit}`);
    if (campos.length) {
      dif++;
      console.log(`\n${a.itemNumber} ${a.name}  (lineage ${a.lineageId})`);
      for (const c of campos) console.log(`   · ${c}`);
    }
  }
  for (const b of it4) if (!por3.has(b.lineageId)) console.log(`SOLO EN V4: ${b.itemNumber} ${b.name} — ${money(b.total)}`);
  console.log(`\nPartidas con alguna diferencia: ${dif}`);

  console.log("\n=== MAESTROS ===");
  console.log(`V3: ${it3.filter((i) => i.maestroId).length}/${it3.length} con maestro`);
  console.log(`V4: ${it4.filter((i) => i.maestroId).length}/${it4.length} con maestro`);
  const conteo = new Map<string, number>();
  for (const i of it4) if (i.maestroId) conteo.set(nomMaestro(i.maestroId), (conteo.get(nomMaestro(i.maestroId)) ?? 0) + 1);
  for (const [k, n] of conteo) console.log(`   V4 · ${k}: ${n} partidas`);
  console.log("Sin maestro en V4:", it4.filter((i) => !i.maestroId).map((i) => `${i.itemNumber} ${i.name}`).join(" | "));

  // Componentes de la partida del porcelanato XL (cambio D)
  const XL = "cmsj83r82000rl204v6otupee";
  for (const [rot, lista] of [["V3", it3], ["V4", it4]] as const) {
    const it = lista.find((i) => i.lineageId === XL);
    if (!it) continue;
    const comps = await prisma.obraItemComponent.findMany({
      where: { obraItemId: it.id },
      orderBy: { sortOrder: "asc" },
      select: { id: true, type: true, description: true, unit: true, quantity: true, unitCost: true, totalCost: true, materialId: true, originComponentId: true, isCustomized: true, referenceLink: true, appliedToComponentId: true, appliedToType: true, sortOrder: true },
    });
    console.log(`\n=== ${rot} · ${it.itemNumber} ${it.name} — PU ${it.unitPrice} × ${it.quantity} = ${money(it.total)} ===`);
    console.log(`   costos: mat=${it.costMaterial} mo=${it.costLabor} sub=${it.costSubcontract} margen=${it.costMargin} herr=${it.costTools} perdida=${it.costLoss}`);
    for (const c of comps) console.log(`   [${c.type}] ${c.description} · ${c.quantity} ${c.unit} × ${c.unitCost} = ${c.totalCost} (sort=${c.sortOrder}, applied=${c.appliedToType ?? "-"})`);
  }

  // Estados de pago — ¿quedaron colgando?
  const eps = await prisma.estadoPago.findMany({
    where: { projectId: p.id },
    select: {
      id: true, number: true, status: true, maestroId: true, budgetVersionId: true,
      items: { select: { id: true, obraItemId: true, lineageId: true, name: true, amountPaid: true, quantityExecuted: true, laborUnitPrice: true, outOfScope: true } },
    },
    orderBy: [{ maestroId: "asc" }, { number: "asc" }],
  });
  const idsV3 = new Set(it3.map((i) => i.id));
  console.log("\n=== ESTADOS DE PAGO DE SENA ===");
  for (const ep of eps) {
    const rotos = ep.items.filter((i) => !idsV3.has(i.obraItemId));
    const recuperables = rotos.filter((i) => por3.has(i.lineageId));
    const monto = ep.items.reduce((s, i) => s + (i.amountPaid ?? 0), 0);
    console.log(
      `EP${ep.number} ${ep.status.padEnd(9)} maestro=${nomMaestro(ep.maestroId)} items=${ep.items.length}` +
        ` colgando=${rotos.length} (recuperables por lineage=${recuperables.length}) pagado=${money(monto)}` +
        ` version=${ep.budgetVersionId === v3.id ? "V3" : (ep.budgetVersionId ?? "-")}`
    );
    const irrecuperables = rotos.filter((i) => !por3.has(i.lineageId));
    for (const i of irrecuperables) console.log(`     SIN LINEAGE EN V3: ${i.name} (lineage ${i.lineageId})`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
