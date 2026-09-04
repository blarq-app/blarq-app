// Reconstruye la FOTO ("volver a lo enviado") de la V3 de obra de Paseo del
// Sena y le pone la fecha real de envío — pendiente 174, segunda parte.
//
// POR QUÉ. La foto vieja se tomó el 7-ago 17:37, cuando la versión se marcó
// "Enviada". Pero el PDF que la clienta tiene en su correo se generó el
// 10-ago 11:16, tres días después, con ajustes que la foto nunca vio. Por eso
// el botón "Volver a lo enviado" hizo daño el 3-sep: restauraba a un estado
// que la clienta nunca recibió. Con la V3 ya reparada, la foto se rehace desde
// ella y `sentAt` pasa a la fecha en que el PDF se generó de verdad.
//
// NO se re-marca la versión como "Enviada" para lograr esto: ese camino
// pondría `sentAt` = hoy, que es falso.
//
// La lógica de armado replica `buildBudgetSnapshot` de
// src/lib/catalog/budgetSnapshot.ts (mismo `schema: 1`, mismos campos, mismos
// `localId` para re-vincular la pérdida a su material). Se replica en vez de
// importarse porque esa función usa el cliente compartido `@/lib/prisma`, que
// resuelve la conexión desde el entorno — y acá la URL de la base viva se lee
// de un archivo y se pasa como datasourceUrl explícito (CLAUDE.md §4.9).
// Si `buildBudgetSnapshot` cambia de forma, este script queda obsoleto: es un
// one-off de reparación, no una pieza de la app.
//
// Uso:
//   npx tsx scripts/reparar-174-foto.ts            # dry-run (default)
//   npx tsx scripts/reparar-174-foto.ts --apply    # escribe en la VIVA

import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

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
// Fecha de generación del PDF que la clienta tiene en su correo
// (BLARQ_Presupuesto_Paseo_del_Sena_V3.pdf, mtime 2026-08-10 11:16 hora de
// Chile = UTC-4 en agosto).
const SENT_AT_REAL = new Date("2026-08-10T15:16:00.000Z");

async function construirFoto(versionId: string) {
  const bv = await prisma.budgetVersion.findUnique({
    where: { id: versionId },
    include: {
      obraItems: { orderBy: { sortOrder: "asc" }, include: { components: { orderBy: { sortOrder: "asc" } } } },
      obraChapters: { orderBy: { sortOrder: "asc" } },
      muebleItems: true,
      artefactoItems: true,
    },
  });
  if (!bv) throw new Error("Versión no encontrada");

  const nombreCapitulo = new Map(bv.obraChapters.map((c) => [c.id, c.name]));

  const obraItems = bv.obraItems.map((it) => {
    const idToLocal = new Map(it.components.map((c, i) => [c.id, `c${i}`]));
    const components = it.components.map((c, i) => ({
      localId: `c${i}`,
      type: c.type, description: c.description, unit: c.unit,
      quantity: c.quantity, unitCost: c.unitCost, totalCost: c.totalCost,
      referenceLink: c.referenceLink, materialId: c.materialId,
      originComponentId: c.originComponentId, isCustomized: c.isCustomized,
      sortOrder: c.sortOrder,
      appliedToLocalId: c.appliedToComponentId ? idToLocal.get(c.appliedToComponentId) ?? null : null,
      appliedToType: c.appliedToType,
    }));
    return {
      lineageId: it.lineageId,
      chapterName: it.chapterId ? nombreCapitulo.get(it.chapterId) ?? "" : "",
      subChapter: it.subChapter,
      itemNumber: it.itemNumber, name: it.name,
      descriptionCliente: it.descriptionCliente, descriptionMaestro: it.descriptionMaestro,
      unit: it.unit, quantity: it.quantity, unitPrice: it.unitPrice, total: it.total,
      costMaterial: it.costMaterial, costLabor: it.costLabor,
      costSubcontract: it.costSubcontract, costMargin: it.costMargin,
      costTools: it.costTools, costLoss: it.costLoss,
      sortOrder: it.sortOrder, catalogPartidaId: it.catalogPartidaId,
      isCustomized: it.isCustomized, components,
    };
  });

  return {
    schema: 1,
    type: bv.type,
    ggPercentage: bv.ggPercentage,
    utilityPercentage: bv.utilityPercentage,
    discountPercentage: bv.discountPercentage,
    observations: bv.observations,
    obraItems,
    muebleItems: bv.muebleItems,
    artefactoItems: bv.artefactoItems,
  };
}

const money = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  const p = await prisma.project.findFirst({ where: { numeroProyecto: 64 }, select: { name: true } });
  if (p?.name !== "Paseo del Sena") throw new Error("ABORTO: #64 no es Paseo del Sena");
  console.log(`BASE: ep-shy-morning (VIVA) · #64 = ${p.name}`);
  console.log(APPLY ? "\n*** MODO --apply: ESCRIBE EN LA VIVA ***\n" : "\n*** DRY-RUN ***\n");

  const antes = await prisma.budgetVersion.findUniqueOrThrow({
    where: { id: V3_ID },
    select: { version: true, status: true, sentAt: true, sentSnapshot: true },
  });
  const fotoVieja = antes.sentSnapshot as { obraItems?: unknown[] } | null;
  const itemsViejos = (fotoVieja?.obraItems ?? []) as { total: number; lineageId: string }[];

  const nueva = await construirFoto(V3_ID);
  const directoNuevo = nueva.obraItems.reduce((s, i) => s + i.total, 0);
  const directoViejo = itemsViejos.reduce((s, i) => s + i.total, 0);

  console.log("----- LA FOTO -----");
  console.log(`  estado de la versión : ${antes.status} (NO se toca)`);
  console.log(`  sentAt  : ${antes.sentAt?.toISOString() ?? "-"} -> ${SENT_AT_REAL.toISOString()}`);
  console.log(`            (7-ago 17:37, cuando se marcó enviada) -> (10-ago 11:16 Chile, cuando se generó el PDF)`);
  console.log(`  partidas en la foto : ${itemsViejos.length} -> ${nueva.obraItems.length}`);
  console.log(`  suma de la foto     : ${money(directoViejo)} -> ${money(directoNuevo)}`);
  console.log(`  (la foto guarda TODAS las partidas, la no cobrada incluida; el`);
  console.log(`   costo directo del PDF excluye la cantería: ${money(directoNuevo - 100000)})`);

  // Chequeo: la foto nueva tiene que reproducir la V3 actual, partida por partida.
  const actuales = await prisma.obraItem.findMany({
    where: { budgetVersionId: V3_ID },
    select: { lineageId: true, quantity: true, unitPrice: true, total: true, descriptionCliente: true },
  });
  const porLin = new Map(nueva.obraItems.map((i) => [i.lineageId, i]));
  let malas = 0;
  for (const a of actuales) {
    const b = porLin.get(a.lineageId);
    if (!b || a.quantity !== b.quantity || Math.abs(a.unitPrice - b.unitPrice) > 0.01 ||
        Math.abs(a.total - b.total) > 0.5 || (a.descriptionCliente ?? "") !== (b.descriptionCliente ?? "")) {
      malas++;
      console.log(`  *** la foto no reproduce ${a.lineageId}`);
    }
  }
  console.log(`  la foto reproduce la V3 reparada: ${malas === 0 ? "SÍ, las " + actuales.length + " partidas" : malas + " diferencias"}`);
  if (malas > 0) throw new Error("ABORTO: la foto no reproduce la V3");

  // La foto NO guarda maestroId / noCobrado / revisado (es la carencia que
  // agravó el incidente). Se deja constancia de qué se perdería si algún día
  // se aprieta el botón de nuevo.
  const conMaestro = await prisma.obraItem.count({ where: { budgetVersionId: V3_ID, maestroId: { not: null } } });
  const noCobradas = await prisma.obraItem.count({ where: { budgetVersionId: V3_ID, noCobrado: true } });
  console.log(`\n  OJO — la foto sigue sin guardar maestroId/noCobrado/revisado (limitación de`);
  console.log(`  pickObraItem en budgetSnapshot.ts). Si se apretara el botón otra vez, se`);
  console.log(`  perderían: ${conMaestro} asignaciones de maestro y ${noCobradas} marca(s) de "no cobrado".`);
  console.log(`  Los montos y textos, en cambio, ya volverían a lo correcto.`);

  if (!APPLY) {
    console.log("\n*** DRY-RUN terminado. Nada se escribió. ***");
    return;
  }

  await prisma.budgetVersion.update({
    where: { id: V3_ID },
    data: { sentSnapshot: nueva as object, sentAt: SENT_AT_REAL },
  });

  const despues = await prisma.budgetVersion.findUniqueOrThrow({
    where: { id: V3_ID },
    select: { version: true, status: true, sentAt: true, sentSnapshot: true, updatedAt: true },
  });
  const foto = despues.sentSnapshot as { obraItems: { total: number }[] };
  console.log("\n========== APLICADO ==========");
  console.log(`  ${despues.version} · estado ${despues.status}`);
  console.log(`  sentAt  : ${despues.sentAt?.toISOString()}`);
  console.log(`  foto    : ${foto.obraItems.length} partidas · suma ${money(foto.obraItems.reduce((s, i) => s + i.total, 0))}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
