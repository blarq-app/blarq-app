// Fusiona el anexo "V4-BANO-VISITAS" DENTRO de una versión nueva V8 de obra en
// Francisco de Aguirre (#54), para que el acuerdo con el cliente viva en UNA
// sola versión.
//
// Por qué: hasta 2026-07-22 el Resumen sumaba TODAS las versiones aprobadas del
// mismo tipo (el caso "anexo"). MJ sacó esa regla — ahora manda una sola
// versión, la última enviada/aprobada. Aguirre era el único proyecto que usaba
// el caso anexo: sin fusionar, su Total Acordado caía de $84.577.305 a
// $22.731.069 porque el anexo del baño (creado 39 segundos DESPUÉS de la V7)
// pasaba a ser "la última".
//
// Qué hace:
//   1. Crea V8 = las 70 partidas de V7 + las 16 del anexo (con subChapter
//      "BAÑO VISITAS" para que se distingan), con sus componentes. Preserva
//      lineageId de cada partida para no romper el diff entre versiones.
//   2. Deja V8 como la única APROBADA; V7 y V4-BANO-VISITAS bajan a "enviado"
//      (siguen en el historial, dejan de sumarse).
//
// Ambas versiones tienen los MISMOS porcentajes (GG 18%, utilidad 5%), así que
// la fusión es exacta: sumar los costos directos y aplicar los % da lo mismo
// que calcular cada una por separado y sumarlas.
//
// Uso:
//   DATABASE_URL='<viva>' npx tsx scripts/fusionar-aguirre-v8.ts          (dry-run)
//   DATABASE_URL='<viva>' npx tsx scripts/fusionar-aguirre-v8.ts --apply  (escribe)

import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");
const SUB_ANEXO = "BAÑO VISITAS";

async function main() {
  const proj = await prisma.project.findFirst({
    where: { numeroProyecto: 54 },
    include: {
      budgetVersions: {
        where: { type: "obra" },
        include: {
          obraItems: { include: { components: true }, orderBy: { sortOrder: "asc" } },
          paymentTerms: true,
        },
      },
    },
  });
  if (!proj) throw new Error("No se encontró el proyecto #54");

  const v7 = proj.budgetVersions.find((b) => b.version === "V7");
  const anexo = proj.budgetVersions.find((b) => b.version === "V4-BANO-VISITAS");
  if (!v7 || !anexo) throw new Error("Faltan V7 o V4-BANO-VISITAS");
  if (proj.budgetVersions.some((b) => b.version === "V8")) {
    throw new Error("Ya existe una V8 de obra — abortado para no duplicar");
  }

  const cd = (items: { total: number; noCobrado: boolean }[]) =>
    items.filter((i) => !i.noCobrado).reduce((s, i) => s + i.total, 0);
  const cdV7 = cd(v7.obraItems);
  const cdAnexo = cd(anexo.obraItems);

  console.log(`Proyecto: ${proj.name} (#${proj.numeroProyecto})`);
  console.log(`  V7              : ${v7.obraItems.length} partidas · costo directo $${Math.round(cdV7).toLocaleString("es-CL")} · GG ${v7.ggPercentage}% Util ${v7.utilityPercentage}%`);
  console.log(`  V4-BANO-VISITAS : ${anexo.obraItems.length} partidas · costo directo $${Math.round(cdAnexo).toLocaleString("es-CL")} · GG ${anexo.ggPercentage}% Util ${anexo.utilityPercentage}%`);
  console.log(`  V8 (a crear)    : ${v7.obraItems.length + anexo.obraItems.length} partidas · costo directo $${Math.round(cdV7 + cdAnexo).toLocaleString("es-CL")}`);

  if (v7.ggPercentage !== anexo.ggPercentage || v7.utilityPercentage !== anexo.utilityPercentage) {
    throw new Error("Los porcentajes de V7 y del anexo NO coinciden — la fusión cambiaría el total. Abortado.");
  }

  const maxSort = Math.max(0, ...v7.obraItems.map((i) => i.sortOrder));
  const filas = [
    ...v7.obraItems.map((i) => ({ src: i, sub: i.subChapter, sort: i.sortOrder })),
    ...anexo.obraItems.map((i, n) => ({ src: i, sub: SUB_ANEXO, sort: maxSort + 1 + n })),
  ];

  if (!APPLY) {
    console.log("\n--- DRY-RUN, no se escribió nada. Se crearía:");
    console.log(`  BudgetVersion V8 (obra, aprobado, GG ${v7.ggPercentage}% / util ${v7.utilityPercentage}%, parent=V7)`);
    console.log(`  ${filas.length} partidas (${filas.reduce((s, f) => s + f.src.components.length, 0)} componentes de desglose)`);
    console.log(`  ${anexo.obraItems.length} de ellas marcadas con subcapítulo "${SUB_ANEXO}"`);
    console.log(`  V7 y V4-BANO-VISITAS pasarían de "aprobado" a "enviado"`);
    console.log("\nPara aplicar: agregar --apply");
    return;
  }

  // El trabajo pesado (86 partidas + 338 componentes) se hace FUERA de una
  // transacción interactiva: sobre el pooler de Neon, meter todo en un solo
  // $transaction supera el timeout de 5s (P2028). En cambio: creamos la V8 en
  // "borrador" (no afecta el Resumen), insertamos partidas y sus componentes, y
  // recién al final —en una transacción corta— publicamos (V8 aprobada, viejas
  // a enviado). Si algo falla ANTES de ese paso, la V8 queda en borrador y se
  // puede borrar y reintentar sin haber tocado el total del proyecto.
  const nueva = await prisma.budgetVersion.create({
    data: {
      projectId: proj.id,
      version: "V8",
      parentVersionId: v7.id,
      type: "obra",
      status: "borrador",
      observations: v7.observations,
      coverTitle: v7.coverTitle,
      coverSubtitle: v7.coverSubtitle,
      coverNote: v7.coverNote,
      ggPercentage: v7.ggPercentage,
      utilityPercentage: v7.utilityPercentage,
      discountPercentage: v7.discountPercentage,
    },
  });

  // Partidas: una por una (para obtener el id y colgarle sus componentes), pero
  // SIN transacción envolvente, así ninguna operación individual expira.
  const compsData = [];
  for (const f of filas) {
    const i = f.src;
    const created = await prisma.obraItem.create({
      data: {
        budgetVersionId: nueva.id,
        lineageId: i.lineageId, // se preserva: DNI de la partida entre versiones
        chapter: i.chapter,
        subChapter: f.sub,
        itemNumber: i.itemNumber,
        name: i.name,
        descriptionCliente: i.descriptionCliente,
        descriptionMaestro: i.descriptionMaestro,
        unit: i.unit,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        total: i.total,
        costMaterial: i.costMaterial,
        costLabor: i.costLabor,
        costSubcontract: i.costSubcontract,
        costMargin: i.costMargin,
        costTools: i.costTools,
        costLoss: i.costLoss,
        sortOrder: f.sort,
        catalogPartidaId: i.catalogPartidaId,
        isCustomized: i.isCustomized,
        noCobrado: i.noCobrado,
        maestroId: i.maestroId,
      },
      select: { id: true },
    });
    for (const c of i.components) {
      compsData.push({
        obraItemId: created.id,
        type: c.type,
        description: c.description,
        unit: c.unit,
        quantity: c.quantity,
        unitCost: c.unitCost,
        totalCost: c.totalCost,
        referenceLink: c.referenceLink,
        materialId: c.materialId,
        originComponentId: c.originComponentId,
        isCustomized: c.isCustomized,
        sortOrder: c.sortOrder,
        appliedToComponentId: c.appliedToComponentId,
        appliedToType: c.appliedToType,
      });
    }
  }
  await prisma.obraItemComponent.createMany({ data: compsData });

  // Formas de pago: se copian de la V7 (el anexo no aporta cuotas propias).
  if (v7.paymentTerms.length) {
    await prisma.paymentTerm.createMany({
      data: v7.paymentTerms.map((pt) => ({
        budgetVersionId: nueva.id,
        stage: pt.stage,
        percentage: pt.percentage,
        amount: pt.amount,
        sortOrder: pt.sortOrder,
      })),
    });
  }

  // Publicación atómica y corta: V8 aprobada + las viejas a enviado, todo o nada.
  await prisma.$transaction([
    prisma.budgetVersion.update({ where: { id: nueva.id }, data: { status: "aprobado" } }),
    prisma.budgetVersion.updateMany({
      where: { id: { in: [v7.id, anexo.id] } },
      data: { status: "enviado" },
    }),
  ]);

  const check = await prisma.obraItem.count({ where: { budgetVersionId: nueva.id } });
  const checkComps = await prisma.obraItemComponent.count({
    where: { obraItem: { budgetVersionId: nueva.id } },
  });
  console.log(`\nAPLICADO. V8 creada (id ${nueva.id}) con ${check} partidas y ${checkComps} componentes.`);
  console.log("V7 y V4-BANO-VISITAS quedaron en estado 'enviado'.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
