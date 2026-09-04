// Detalles finos para armar la reparación del pendiente 174 (READ-ONLY).
// Mira los valores crudos que el diag general resume: nulls vs "", los
// appliedToComponentId de los componentes del porcelanato XL, los
// componentes descartados del catálogo, y el orden real de las partidas.

import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

function urlViva(): string {
  const raw = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8");
  const m = raw.match(/^DATABASE_URL=["']?(.+?)["']?$/m);
  if (!m || !/ep-shy-morning/.test(m[1])) throw new Error("ABORTO: no es la base viva");
  return m[1];
}
const prisma = new PrismaClient({ datasourceUrl: urlViva() });

const V3 = "cmrlip1gu0001l804feonvrmu";
const V4 = "cmt1tz2fg0001kz0463u5f9qb";
const XL = "cmsj83r82000rl204v6otupee";
const MODULO = "cmqpocjtk001lju04tbp4zw3h";
const PAVIMENTO = "cmp5y7p9f00axkz04bruwsdul";
const DUCHA = "cmp5y7p7l0099kz044mm9nfkz";

async function main() {
  console.log("=== VALORES CRUDOS (null vs cadena vacía) ===");
  for (const lin of [MODULO, PAVIMENTO, DUCHA]) {
    for (const [rot, vid] of [["V3", V3], ["V4", V4]] as const) {
      const it = await prisma.obraItem.findFirst({
        where: { budgetVersionId: vid, lineageId: lin },
        select: { name: true, descriptionCliente: true, descriptionMaestro: true, isCustomized: true, catalogPartidaId: true },
      });
      console.log(`${rot} ${lin} ${it?.name}`);
      console.log(`    cliente = ${JSON.stringify(it?.descriptionCliente)}`);
      console.log(`    maestro = ${JSON.stringify(it?.descriptionMaestro)}`);
      console.log(`    isCustomized=${it?.isCustomized} catalogPartidaId=${it?.catalogPartidaId}`);
    }
    console.log("");
  }

  console.log("=== COMPONENTES DEL PORCELANATO XL, crudos ===");
  for (const [rot, vid] of [["V3", V3], ["V4", V4]] as const) {
    const it = await prisma.obraItem.findFirst({ where: { budgetVersionId: vid, lineageId: XL }, select: { id: true, isCustomized: true, catalogPartidaId: true } });
    if (!it) continue;
    console.log(`--- ${rot} obraItemId=${it.id} isCustomized=${it.isCustomized} catalogPartidaId=${it.catalogPartidaId}`);
    const comps = await prisma.obraItemComponent.findMany({ where: { obraItemId: it.id }, orderBy: { sortOrder: "asc" } });
    for (const c of comps) console.log("   ", JSON.stringify(c));
    const desc = await prisma.obraItemDiscardedCatalogComponent.findMany({ where: { obraItemId: it.id } });
    console.log(`   descartados del catálogo: ${desc.length}`, JSON.stringify(desc));
  }

  console.log("\n=== ORDEN REAL DE LA V3 (con capítulos) ===");
  const caps = await prisma.obraChapter.findMany({ where: { budgetVersionId: V3 }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, sortOrder: true } });
  const items = await prisma.obraItem.findMany({
    where: { budgetVersionId: V3 }, orderBy: { sortOrder: "asc" },
    select: { lineageId: true, chapterId: true, subChapter: true, name: true, unit: true, quantity: true, unitPrice: true, total: true, noCobrado: true, sortOrder: true },
  });
  for (const c of caps) {
    console.log(`\n## ${c.name} (sort=${c.sortOrder})`);
    for (const i of items.filter((x) => x.chapterId === c.id)) {
      console.log(`  ${i.noCobrado ? "[NO COBRADO] " : ""}${i.name.replace(/\n/g, " ")} | ${i.unit} | ${i.quantity} | ${Math.round(i.unitPrice)} | ${Math.round(i.total)} | sub=${i.subChapter ?? "-"} | sort=${i.sortOrder}`);
    }
  }
  const huerfanas = items.filter((i) => !caps.some((c) => c.id === i.chapterId));
  if (huerfanas.length) console.log("\nSIN CAPÍTULO:", huerfanas.map((i) => i.name).join(" | "));
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
