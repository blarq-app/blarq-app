// Repara la V3 de obra de Paseo del Sena (#64) — pendiente 174.
//
// CONTEXTO. El 2026-09-03 MJ apretó "Volver a lo enviado" en la V3. La foto
// (`sentSnapshot`) se había tomado el 7-ago 17:37, pero el PDF que la clienta
// tiene en su correo se generó el 10-ago 11:16 — tres días después, con
// ajustes que la foto nunca vio. El restore deshizo esos ajustes y, encima,
// borró la asignación de maestros (la foto no guarda `maestroId`, `noCobrado`
// ni `revisado`: ver `pickObraItem` en src/lib/catalog/budgetSnapshot.ts).
// Como el restore BORRA y RECREA las 58 partidas, los EstadoPagoItem de los
// 4 EPs quedaron apuntando a filas muertas (no hay FK, así que no se perdió
// plata: cada EP guarda su propia copia de cantidades y precios).
//
// LA FUENTE DE VERDAD ES EL PDF, no la app. La V4 (borrador del 20-ago,
// duplicada de la V3) conservó el estado bueno y se usa como origen de los
// valores; el PDF es el árbitro y se verifica línea por línea al final.
//
// QUÉ TOCA (todo por lineageId, nunca por id):
//   A · maestroId de las 54 partidas que la V4 tiene asignadas.
//   B · noCobrado = true en 6.12 CANTERÍA BAÑOS (por eso no sale en el PDF).
//   C · 3.9 CAMBIO MODULO ELECTRICO: quantity 3 -> 5 y descriptionCliente
//       vuelve a vacío. (OJO: hay otra partida con el mismo nombre, la 3.4
//       con cantidad 2, que NO se toca — por eso se va por lineageId.)
//   D · 6.15 REVESTIMIENTO PORCELANATO XL: saca el material de provisión que
//       era doble cobro (el porcelanato ya se cobra en 6.13) y deja el
//       desglose igual al de la V4 — pérdida $587,22 y margen 15%.
//   E · dos textos que la foto pisó (5.1 descriptionCliente, 4.7
//       descriptionMaestro — este último lo escribió JT).
//   F · re-engancha EstadoPagoItem.obraItemId por lineageId dentro de la V3.
//
// QUÉ NO TOCA: la V4 (tiene 3 partidas propias que la V3 no debe tener), el
// sentSnapshot (decisión aparte de MJ), ni una sola línea de cálculo.
//
// Uso:
//   npx tsx scripts/reparar-174-sena-v3.ts            # dry-run (default)
//   npx tsx scripts/reparar-174-sena-v3.ts --apply    # escribe en la VIVA

import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import {
  computeProjectMetrics,
  PROJECT_METRICS_INCLUDE,
  type ProjectWithMetrics,
} from "../src/lib/projects/metrics";

// La URL sale de un archivo local, nunca del chat, y se pasa como
// datasourceUrl explícito: así ni dotenv ni el auto-load de Prisma pueden
// desviar el script a la base vieja (ep-solitary-mud). Ver CLAUDE.md §4.9.
function urlViva(): string {
  const raw = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8");
  const m = raw.match(/^DATABASE_URL=["']?(.+?)["']?$/m);
  if (!m) throw new Error("No encontré DATABASE_URL en .env.prod");
  if (!/ep-shy-morning/.test(m[1])) throw new Error("ABORTO: .env.prod no apunta a ep-shy-morning");
  return m[1];
}

const prisma = new PrismaClient({ datasourceUrl: urlViva() });
const APPLY = process.argv.includes("--apply");

const V3_ID = "cmrlip1gu0001l804feonvrmu";
const V4_ID = "cmt1tz2fg0001kz0463u5f9qb";

const LIN_CANTERIA = "cmsdihuyz000ala04nmlss4r7";
const LIN_MODULO = "cmqpocjtk001lju04tbp4zw3h";
const LIN_XL = "cmsj83r82000rl204v6otupee";
const LIN_PAVIMENTO = "cmp5y7p9f00axkz04bruwsdul";
const LIN_DUCHA = "cmp5y7p7l0099kz044mm9nfkz";

const money = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

// Las 57 líneas que IMPRIME el PDF que la clienta tiene en su correo
// (BLARQ_Presupuesto_Paseo_del_Sena_V3.pdf, 10-ago 11:16), en su orden.
// [nombre, unidad, cantidad, P.U. redondeado, total redondeado]
const PDF: [string, string, number, number, number][] = [
  ["PERFORACION MURO / LOSA HORMIGON", "GL", 1, 330000, 330000],
  ["RETIRO MOBILIARIO COCINA", "GL", 1, 232000, 232000],
  ["RETIRO PISO CERAMICO", "M2", 12.1, 8263, 99985],
  ["RETIRO PUERTAS", "UN", 2, 26000, 52000],
  ["RETIRO REVESTIMIENTO CERAMICO", "M2", 32.4, 7969, 258202],
  ["RETIRO ARTEFACTOS Y ACCESORIOS DE BAÑO", "GL", 3, 88000, 264000],
  ["RETIRO PISO CERAMICO", "M2", 6.8, 8263, 56190],
  ["RETIRO REVESTIMIENTO CERAMICO", "M2", 43, 7969, 342676],
  ["PILAR HORMIGÓN", "GL", 1, 160000, 160000],
  ["CONSTRUCCION TABIQUE INTERIOR", "M2", 3.36, 60448, 203106],
  ["ENLUCIDO DE MUROS", "M2", 30.63, 21195, 649193],
  ["REPARACION GENERAL", "GL", 1, 482400, 482400],
  ["REPARACION GENERAL", "GL", 1, 170000, 170000],
  ["MODIFICACIONES SANITARIAS COCINA", "GL", 1, 368550, 368550],
  ["MODIFICACION TUBERIA GAS", "GL", 1, 108830, 108830],
  ["INSTALACION GRIFERIA LAVAPLATOS", "UN", 1, 38500, 38500],
  ["INSTALACION DESAGUE LAVAPLATOS / LAVAMANOS", "UN", 1, 36933, 36933],
  ["LLAVE DE PASO GAS", "UN", 1, 87251, 87251],
  ["INSTALACION ENCIMERA GAS", "UN", 1, 62419, 62419],
  ["INSTALACION LAVAVAJILLAS", "UN", 1, 54000, 54000],
  ["MODIFICACIONES SANITARIAS BAÑO", "GL", 1, 629451, 629451],
  ["INSTALACION DESAGUE LAVAPLATOS / LAVAMANOS", "UN", 4, 36933, 147732],
  ["INSTALACION GRIFERIA LAVAMANOS", "UN", 4, 34500, 138000],
  ["INSTALACION WC", "UN", 3, 63000, 189000],
  ["INSTALACION GRIFERIA DUCHA/TINA", "UN", 3, 38500, 115500],
  ["CONSTRUCCION DUCHA EN OBRA", "UN", 3, 384968, 1154903],
  ["INSTALACION DESAGUE DUCHA/TINA", "UN", 3, 60000, 180000],
  ["INSTALACION MAMPARA CRISTAL", "UN", 3, 69000, 207000],
  ["INSTALACION MUEBLES VANITORIO", "UN", 2, 47500, 95000],
  ["INSTALACION ACCESORIOS DE BAÑO", "GL", 3, 25000, 75000],
  ["INSTALACION LUMINARIA", "UN", 3, 17250, 51750],
  ["NUEVO ARRANQUE ELECTRICO", "UN", 4, 55200, 220800],
  ["ENCHUFE / INTERRUPTOR NUEVO SINTHESI S33", "UN", 16, 58782, 940509],
  ["CAMBIO MODULO ELECTRICO", "UN", 2, 14926, 29851],
  ["INSTALACION CAMPANA", "UN", 1, 48000, 48000],
  ["INSTALACION HORNO ELECTRICO", "UN", 1, 23150, 23150],
  ["TRASLADO INTERRUPTOR", "UN", 1, 57600, 57600],
  ["NUEVO ARRANQUE ELECTRICO", "UN", 3, 55200, 165600],
  ["CAMBIO MODULO ELECTRICO", "UN", 5, 14926, 74628], // ← cambio C
  ["ENCHUFE / INTERRUPTOR NUEVO SINTHESI S33", "UN", 1, 58782, 58782],
  ["INSTALACION LUMINARIA", "UN", 6, 23000, 138000],
  ["INSTALACION EXTRACTOR", "UN", 1, 63499, 63499],
  ["INSTALACION PAVIMENTO PORCELANATO", "M2", 12.1, 23660, 286284],
  ["PINTURA DE MUROS", "M2", 60.39, 10714, 646996],
  ["PINTURA DE CIELOS BAÑOS/COCINA", "M2", 12.1, 9699, 117359],
  ["PINTURA DE CIELOS", "M2", 23, 8179, 188127],
  ["INSTALACION DE PUERTAS", "UN", 2, 20000, 40000],
  ["INSTALACION GUARDAPOLVO PORCELANATO", "ML", 11.72, 10076, 118090],
  ["ESPEJO A MEDIDA", "UN", 1, 612000, 612000],
  ["INSTALACION PAVIMENTO PORCELANATO", "M2", 4.2, 23660, 99371],
  ["INSTALACION REVESTIMIENTO PORCELANATO", "M2", 28.6, 28808, 823916],
  ["INSTALACION REVESTIMIENTO PORCELANATO XL BAÑO PRINCIPAL", "M2", 18.65, 30340, 565846], // ← cambio D
  ["PROVISION DE PORCELANATO", "GL", 1, 2468208, 2468208],
  ["PINTURA DE CIELOS BAÑOS/COCINA", "M2", 6.8, 9699, 65954],
  ["CONSTRUCCION TABIQUE INTERIOR RH", "GL", 1, 126042, 126042],
  ["LIMPIEZA Y CUIDADO GENERAL DE OBRA", "GL", 1, 377256, 377256],
  ["RETIRO DE ESCOMBROS MEDIANO", "UN", 3, 352334, 1057003],
];

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toUpperCase();

async function fotoDelProyecto(projectId: string, rotulo: string) {
  const p = (await prisma.project.findUnique({
    where: { id: projectId },
    include: PROJECT_METRICS_INCLUDE,
  })) as ProjectWithMetrics | null;
  if (!p) throw new Error("proyecto no encontrado");
  const m = computeProjectMetrics(p);
  console.log(`\n----- SNAPSHOT ${rotulo} (proyecto completo, computeProjectMetrics) -----`);
  console.log(`  versión de obra vigente : ${m.versionLabels.obra ?? "-"}`);
  console.log(`  total acordado (c/IVA)  : ${money(m.totalAcordado)}`);
  console.log(`  total acordado neto     : ${money(m.totalAcordadoNeto)}`);
  console.log(`  total cobrado (c/IVA)   : ${money(m.totalCobrado)}`);
  console.log(`  total gastado (neto)    : ${money(m.totalGastado)}`);
  console.log(`  utilidad real           : ${money(m.utilidadReal)}`);
  console.log(`  utilidad proyectada     : ${money(m.utilidadProyectada)}`);
  console.log(`  % cobrado               : ${m.pctCobrado.toFixed(2)}%`);
  console.log(`  avance de obra           : ${m.avanceObraPct.toFixed(2)}%`);
  console.log(`  MO presupuestada (budgetByType.costLabor): ${money(m.budgetByType.costLabor ?? 0)}`);
  return m;
}

async function totalesV3(rotulo: string) {
  const v = await prisma.budgetVersion.findUniqueOrThrow({
    where: { id: V3_ID },
    select: { ggPercentage: true, utilityPercentage: true },
  });
  const items = await prisma.obraItem.findMany({
    where: { budgetVersionId: V3_ID },
    select: { total: true, noCobrado: true, maestroId: true },
  });
  const directo = items.filter((i) => !i.noCobrado).reduce((s, i) => s + i.total, 0);
  const gg = directo * ((v.ggPercentage ?? 0) / 100);
  const ut = directo * ((v.utilityPercentage ?? 0) / 100);
  const neto = directo + gg + ut;
  const total = neto * 1.19;
  console.log(`\n----- TOTALES DE LA V3 ${rotulo} -----`);
  console.log(`  costo directo    : ${money(directo)}`);
  console.log(`  GG ${v.ggPercentage}%          : ${money(gg)}`);
  console.log(`  utilidad ${v.utilityPercentage}%    : ${money(ut)}`);
  console.log(`  costo neto       : ${money(neto)}`);
  console.log(`  IVA 19%          : ${money(neto * 0.19)}`);
  console.log(`  TOTAL c/IVA      : ${money(total)}`);
  console.log(`  partidas         : ${items.length} (${items.filter((i) => i.noCobrado).length} no cobradas)`);
  console.log(`  con maestro      : ${items.filter((i) => i.maestroId).length} de ${items.length}`);
  return { directo, neto, total };
}

async function fotoEPs(rotulo: string) {
  const eps = await prisma.estadoPago.findMany({
    where: { project: { numeroProyecto: 64 } },
    select: {
      id: true, number: true, status: true,
      maestro: { select: { name: true } },
      items: { select: { obraItemId: true, lineageId: true, amountPaid: true, quantityExecuted: true, laborUnitPrice: true, laborTotal: true } },
    },
    orderBy: [{ maestroId: "asc" }, { number: "asc" }],
  });
  const vivos = new Set((await prisma.obraItem.findMany({ where: { budgetVersionId: V3_ID }, select: { id: true } })).map((i) => i.id));
  console.log(`\n----- ESTADOS DE PAGO ${rotulo} -----`);
  for (const ep of eps) {
    const pagado = ep.items.reduce((s, i) => s + (i.amountPaid ?? 0), 0);
    const colgando = ep.items.filter((i) => !vivos.has(i.obraItemId)).length;
    console.log(
      `  EP${ep.number} ${ep.status.padEnd(9)} ${(ep.maestro?.name ?? "sin maestro").padEnd(14)}` +
        ` items=${ep.items.length} colgando=${colgando} pagado=${money(pagado)}`
    );
  }
  return eps.map((e) => ({ id: e.id, pagado: e.items.reduce((s, i) => s + (i.amountPaid ?? 0), 0) }));
}

async function main() {
  const p = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { id: true, name: true },
  });
  if (!p || !/sena/i.test(p.name)) throw new Error("ABORTO: #64 no es Paseo del Sena — ¿base equivocada?");
  console.log(`BASE: ep-shy-morning (VIVA) · #64 = ${p.name}`);
  console.log(APPLY ? "\n*** MODO --apply: ESTO ESCRIBE EN LA BASE VIVA ***\n" : "\n*** DRY-RUN: no escribe nada ***\n");

  const metricsAntes = await fotoDelProyecto(p.id, "ANTES");
  const totAntes = await totalesV3("ANTES");
  const epsAntes = await fotoEPs("ANTES");

  const sel = {
    id: true, lineageId: true, name: true, quantity: true, unitPrice: true, total: true,
    noCobrado: true, maestroId: true, descriptionCliente: true, descriptionMaestro: true,
    costMaterial: true, costLabor: true, costSubcontract: true, costMargin: true,
    costTools: true, costLoss: true,
  } as const;
  const it3 = await prisma.obraItem.findMany({ where: { budgetVersionId: V3_ID }, select: sel });
  const it4 = await prisma.obraItem.findMany({ where: { budgetVersionId: V4_ID }, select: sel });
  const por3 = new Map(it3.map((i) => [i.lineageId, i]));
  const por4 = new Map(it4.map((i) => [i.lineageId, i]));

  console.log("\n========== PLAN DE CAMBIOS ==========");

  // A · maestros
  const planMaestros = it4
    .filter((b) => b.maestroId && por3.has(b.lineageId) && por3.get(b.lineageId)!.maestroId !== b.maestroId)
    .map((b) => ({ id: por3.get(b.lineageId)!.id, lineageId: b.lineageId, name: b.name, maestroId: b.maestroId! }));
  const maestros = await prisma.maestro.findMany({ select: { id: true, name: true } });
  const nomM = (id: string) => maestros.find((m) => m.id === id)?.name ?? id;
  const porMaestro = new Map<string, number>();
  for (const x of planMaestros) porMaestro.set(nomM(x.maestroId), (porMaestro.get(nomM(x.maestroId)) ?? 0) + 1);
  console.log(`\nA · MAESTROS — ${planMaestros.length} partidas recuperan su maestro`);
  for (const [k, n] of porMaestro) console.log(`     ${k}: ${n}`);
  console.log(`     quedan sin maestro: ${it3.length - planMaestros.length} (las mismas 4 que tampoco lo tienen en la V4)`);

  // B · noCobrado
  const canteria = por3.get(LIN_CANTERIA);
  if (!canteria) throw new Error("no encontré CANTERÍA BAÑOS en la V3");
  console.log(`\nB · NO COBRADO — ${canteria.name} (${money(canteria.total)}): noCobrado ${canteria.noCobrado} -> true`);
  console.log(`     sale del costo directo: −${money(canteria.total)}`);

  // C · cantidad del cambio de módulo
  const modulo3 = por3.get(LIN_MODULO);
  const modulo4 = por4.get(LIN_MODULO);
  if (!modulo3 || !modulo4) throw new Error("no encontré 3.9 CAMBIO MODULO ELECTRICO");
  const moduloTotal = modulo4.quantity * modulo3.unitPrice;
  console.log(`\nC · ${modulo3.name} (lineage ${LIN_MODULO})`);
  console.log(`     quantity ${modulo3.quantity} -> ${modulo4.quantity} · P.U. ${modulo3.unitPrice} (sin cambio)`);
  console.log(`     total ${money(modulo3.total)} -> ${money(moduloTotal)}  (+${money(moduloTotal - modulo3.total)})`);
  console.log(`     descriptionCliente ${JSON.stringify(modulo3.descriptionCliente)} -> ${JSON.stringify(modulo4.descriptionCliente)}`);
  const gemela = it3.find((i) => norm(i.name) === norm(modulo3.name) && i.lineageId !== LIN_MODULO);
  console.log(`     (la gemela 3.4 "${gemela?.name}" cant=${gemela?.quantity} NO se toca)`);

  // D · porcelanato XL
  const xl3 = por3.get(LIN_XL);
  const xl4 = por4.get(LIN_XL);
  if (!xl3 || !xl4) throw new Error("no encontré 6.15 PORCELANATO XL");
  const comps4 = await prisma.obraItemComponent.findMany({ where: { obraItemId: xl4.id }, orderBy: { sortOrder: "asc" } });
  const comps3 = await prisma.obraItemComponent.findMany({ where: { obraItemId: xl3.id }, orderBy: { sortOrder: "asc" } });
  console.log(`\nD · ${xl3.name.replace(/\n/g, " ")} — doble cobro del porcelanato`);
  console.log(`     P.U. ${xl3.unitPrice} -> ${xl4.unitPrice} · total ${money(xl3.total)} -> ${money(xl4.total)} (−${money(xl3.total - xl4.total)})`);
  console.log(`     componentes: ${comps3.length} -> ${comps4.length}. Se van:`);
  for (const c of comps3) {
    if (!comps4.some((d) => d.originComponentId === c.originComponentId && d.description === c.description)) {
      console.log(`        − [${c.type}] ${c.description} (${c.quantity} ${c.unit} × ${c.unitCost})`);
    }
  }
  console.log(`     margen 5% -> 15% · pérdida $0 -> $587,22`);
  console.log(`     costos: mat ${xl3.costMaterial} -> ${xl4.costMaterial} · perdida ${xl3.costLoss} -> ${xl4.costLoss} · margen ${xl3.costMargin} -> ${xl4.costMargin}`);

  // E · textos pisados
  const pav3 = por3.get(LIN_PAVIMENTO), pav4 = por4.get(LIN_PAVIMENTO);
  const duc3 = por3.get(LIN_DUCHA), duc4 = por4.get(LIN_DUCHA);
  if (!pav3 || !pav4 || !duc3 || !duc4) throw new Error("no encontré las partidas de textos");
  console.log(`\nE · TEXTOS QUE LA FOTO PISÓ`);
  console.log(`     ${pav3.name} · descriptionCliente:`);
  console.log(`        de : ${pav3.descriptionCliente}`);
  console.log(`        a  : ${pav4.descriptionCliente}`);
  console.log(`     ${duc3.name} · descriptionMaestro (lo escribió JT):`);
  console.log(`        de : ${duc3.descriptionMaestro}`);
  console.log(`        a  : ${duc4.descriptionMaestro}`);

  // F · re-enganche de EPs
  const idPorLineage = new Map(it3.map((i) => [i.lineageId, i.id]));
  const epItems = await prisma.estadoPagoItem.findMany({
    where: { estadoPago: { project: { numeroProyecto: 64 } } },
    select: { id: true, obraItemId: true, lineageId: true, name: true, estadoPago: { select: { number: true, maestro: { select: { name: true } } } } },
  });
  const vivos = new Set(it3.map((i) => i.id));
  const reenganchar = epItems
    .filter((i) => !vivos.has(i.obraItemId) && idPorLineage.has(i.lineageId))
    .map((i) => ({ id: i.id, nuevo: idPorLineage.get(i.lineageId)! }));
  const huerfanos = epItems.filter((i) => !vivos.has(i.obraItemId) && !idPorLineage.has(i.lineageId));
  console.log(`\nF · ESTADOS DE PAGO — ${reenganchar.length} líneas vuelven a apuntar a su partida de la V3`);
  console.log(`     sin equivalente en la V3 (se dejan como están): ${huerfanos.length}`);
  for (const h of huerfanos) console.log(`        EP${h.estadoPago.number} ${h.estadoPago.maestro?.name}: ${h.name} — partida que ya no existe en la V3`);

  // Proyección del total
  const directoProyectado =
    totAntes.directo + (moduloTotal - modulo3.total) - (xl3.total - xl4.total) - canteria.total;
  console.log("\n========== PROYECCIÓN ==========");
  console.log(`  costo directo : ${money(totAntes.directo)} -> ${money(directoProyectado)}`);
  console.log(`  total c/IVA   : ${money(totAntes.total)} -> ${money(directoProyectado * 1.3 * 1.19)}`);
  console.log(`  objetivo PDF  : $16.452.440 directo · $25.451.925 total`);

  if (!APPLY) {
    console.log("\n*** DRY-RUN terminado. Nada se escribió. Correr con --apply para ejecutar. ***");
    return;
  }

  // ---------------- ESCRITURA ----------------
  await prisma.$transaction(async (tx) => {
    for (const x of planMaestros) {
      await tx.obraItem.update({ where: { id: x.id }, data: { maestroId: x.maestroId } });
    }
    await tx.obraItem.update({ where: { id: canteria.id }, data: { noCobrado: true } });
    await tx.obraItem.update({
      where: { id: modulo3.id },
      data: { quantity: modulo4.quantity, total: moduloTotal, descriptionCliente: modulo4.descriptionCliente },
    });
    // D: el desglose se reemplaza entero por el de la V4 (mismo criterio que
    // el duplicador de versiones: se copian los campos, no los ids).
    await tx.obraItemComponent.deleteMany({ where: { obraItemId: xl3.id } });
    for (const c of comps4) {
      await tx.obraItemComponent.create({
        data: {
          obraItemId: xl3.id, type: c.type, description: c.description, unit: c.unit,
          quantity: c.quantity, unitCost: c.unitCost, totalCost: c.totalCost,
          referenceLink: c.referenceLink, materialId: c.materialId,
          originComponentId: c.originComponentId, isCustomized: c.isCustomized,
          sortOrder: c.sortOrder, appliedToComponentId: null, appliedToType: c.appliedToType,
        },
      });
    }
    await tx.obraItem.update({
      where: { id: xl3.id },
      data: {
        unitPrice: xl4.unitPrice, total: xl4.total,
        costMaterial: xl4.costMaterial, costLabor: xl4.costLabor,
        costSubcontract: xl4.costSubcontract, costMargin: xl4.costMargin,
        costTools: xl4.costTools, costLoss: xl4.costLoss,
      },
    });
    await tx.obraItem.update({ where: { id: pav3.id }, data: { descriptionCliente: pav4.descriptionCliente } });
    await tx.obraItem.update({ where: { id: duc3.id }, data: { descriptionMaestro: duc4.descriptionMaestro } });
    for (const r of reenganchar) {
      await tx.estadoPagoItem.update({ where: { id: r.id }, data: { obraItemId: r.nuevo } });
    }
  }, { timeout: 120000 });

  console.log("\n========== APLICADO ==========");
  const totDespues = await totalesV3("DESPUÉS");
  const metricsDespues = await fotoDelProyecto(p.id, "DESPUÉS");
  const epsDespues = await fotoEPs("DESPUÉS");

  console.log("\n----- QUÉ SE MOVIÓ EN EL PROYECTO -----");
  const dif = (a: number, b: number, rot: string) =>
    console.log(`  ${rot.padEnd(24)} ${money(a)} -> ${money(b)}  (${b - a >= 0 ? "+" : "−"}${money(Math.abs(b - a))})`);
  dif(metricsAntes.totalAcordado, metricsDespues.totalAcordado, "total acordado c/IVA");
  dif(metricsAntes.totalAcordadoNeto, metricsDespues.totalAcordadoNeto, "total acordado neto");
  dif(metricsAntes.totalCobrado, metricsDespues.totalCobrado, "total cobrado");
  dif(metricsAntes.totalGastado, metricsDespues.totalGastado, "total gastado");
  dif(metricsAntes.utilidadReal, metricsDespues.utilidadReal, "utilidad real");
  dif(metricsAntes.utilidadProyectada, metricsDespues.utilidadProyectada, "utilidad proyectada");
  dif(metricsAntes.budgetByType.costLabor ?? 0, metricsDespues.budgetByType.costLabor ?? 0, "MO presupuestada");
  console.log(`  avance de obra           ${metricsAntes.avanceObraPct.toFixed(2)}% -> ${metricsDespues.avanceObraPct.toFixed(2)}%`);

  console.log("\n----- LA PLATA DE LOS EPs NO SE MOVIÓ -----");
  for (const a of epsAntes) {
    const b = epsDespues.find((x) => x.id === a.id)!;
    console.log(`  EP ${a.id}: ${money(a.pagado)} -> ${money(b.pagado)} ${Math.abs(a.pagado - b.pagado) < 0.5 ? "OK" : "*** SE MOVIÓ ***"}`);
  }

  // Verificación línea por línea contra el PDF
  console.log("\n========== VERIFICACIÓN CONTRA EL PDF (57 líneas) ==========");
  const caps = await prisma.obraChapter.findMany({ where: { budgetVersionId: V3_ID }, orderBy: { sortOrder: "asc" }, select: { id: true } });
  const orden = new Map(caps.map((c, n) => [c.id, n]));
  const finales = (await prisma.obraItem.findMany({
    where: { budgetVersionId: V3_ID, noCobrado: false },
    select: { name: true, unit: true, quantity: true, unitPrice: true, total: true, chapterId: true, sortOrder: true },
  })).sort((a, b) => (orden.get(a.chapterId ?? "") ?? 99) - (orden.get(b.chapterId ?? "") ?? 99) || a.sortOrder - b.sortOrder);

  let fallas = 0;
  if (finales.length !== PDF.length) {
    console.log(`*** El PDF tiene ${PDF.length} líneas y la V3 quedó con ${finales.length} cobrables ***`);
    fallas++;
  }
  for (let i = 0; i < Math.min(finales.length, PDF.length); i++) {
    const a = finales[i];
    const [n, u, q, pu, t] = PDF[i];
    const errs: string[] = [];
    if (norm(a.name) !== norm(n)) errs.push(`nombre "${a.name.replace(/\n/g, " ")}" ≠ "${n}"`);
    if (a.unit !== u) errs.push(`unidad ${a.unit} ≠ ${u}`);
    if (Math.abs(a.quantity - q) > 0.001) errs.push(`cantidad ${a.quantity} ≠ ${q}`);
    if (Math.abs(Math.round(a.unitPrice) - pu) > 1) errs.push(`P.U. ${Math.round(a.unitPrice)} ≠ ${pu}`);
    if (Math.abs(Math.round(a.total) - t) > 1) errs.push(`total ${Math.round(a.total)} ≠ ${t}`);
    if (errs.length) { fallas++; console.log(`  línea ${i + 1}: ${errs.join(" · ")}`); }
  }
  const sumaPdf = PDF.reduce((s, r) => s + r[4], 0);
  console.log(`  suma de las 57 líneas del PDF : ${money(sumaPdf)}`);
  console.log(`  costo directo de la V3        : ${money(totDespues.directo)}`);
  console.log(`  objetivo                      : $16.452.440 · total c/IVA $25.451.925`);
  console.log(`  quedó                         : ${money(totDespues.directo)} · total c/IVA ${money(totDespues.total)}`);
  console.log(fallas === 0 ? "\n  ✔ Las 57 líneas calzan con el PDF, una por una." : `\n  *** ${fallas} discrepancias contra el PDF ***`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
