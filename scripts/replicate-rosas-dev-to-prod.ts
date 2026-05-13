// Replicación dev → prod del proyecto Rosas (V4 obra).
//
// Copia desde dev a prod:
//   1. Partidas de catálogo nuevas (matcheo por unique [category, name]).
//   2. BudgetVersion V4 obra del proyecto.
//   3. ObraItems (5) con catalogPartidaId remapeado.
//
// NO replica:
//   - Facturas (Rosas todavía no tiene legacy ni manuales).
//   - Muebles ni artefactos (no existen para este proyecto aún).
//
// Uso:
//   DATABASE_URL='...dev...' DATABASE_URL_PROD='...prod...' \
//   npx tsx scripts/replicate-rosas-dev-to-prod.ts            # dry-run
//   ... npx tsx scripts/replicate-rosas-dev-to-prod.ts --apply

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const DEV_URL = process.env.DATABASE_URL;
const PROD_URL = process.env.DATABASE_URL_PROD;

if (!DEV_URL || !PROD_URL) {
  console.error("Faltan DATABASE_URL / DATABASE_URL_PROD");
  process.exit(1);
}
if (!/ep-solitary-mud/.test(DEV_URL)) {
  console.error("DATABASE_URL no parece dev (esperado ep-solitary-mud)");
  process.exit(1);
}
if (!/ep-shy-morning/.test(PROD_URL)) {
  console.error("DATABASE_URL_PROD no parece prod (esperado ep-shy-morning)");
  process.exit(1);
}

const dev = new PrismaClient({ datasources: { db: { url: DEV_URL } } });
const prod = new PrismaClient({ datasources: { db: { url: PROD_URL } } });

function tag() {
  return APPLY ? "[APPLY]" : "[DRY-RUN]";
}

async function main() {
  console.log(`${tag()} Iniciando replicación Rosas dev → prod`);

  const rosasDev = await dev.project.findFirst({
    where: { name: { contains: "Rosas" } },
  });
  const rosasProd = await prod.project.findFirst({
    where: { name: { contains: "Rosas" } },
  });
  if (!rosasDev || !rosasProd) throw new Error("Falta Rosas en alguna BD");

  console.log(`  dev:  ${rosasDev.name} (id=${rosasDev.id})`);
  console.log(`  prod: ${rosasProd.name} (id=${rosasProd.id})`);

  // Confirmar que prod NO tiene ya la V4 obra (si la tiene, abortar).
  const existingProdBv = await prod.budgetVersion.findFirst({
    where: { projectId: rosasProd.id, type: "obra", version: "V4" },
  });
  if (existingProdBv) {
    console.error(
      `\n  Prod ya tiene un BudgetVersion V4 obra para Rosas (id=${existingProdBv.id}). Aborto.`
    );
    process.exit(1);
  }

  // ===== FASE 1: PartidaCatalog =====
  console.log(`\n=== FASE 1: PartidaCatalog ===`);

  const bvsDev = await dev.budgetVersion.findMany({
    where: { projectId: rosasDev.id, type: "obra", version: "V4" },
    include: { obraItems: true },
  });

  if (bvsDev.length === 0) {
    console.error("No se encontró BudgetVersion V4 obra de Rosas en dev. Aborto.");
    process.exit(1);
  }

  const partidaDevIds = new Set<string>();
  for (const bv of bvsDev) {
    for (const it of bv.obraItems) {
      if (it.catalogPartidaId) partidaDevIds.add(it.catalogPartidaId);
    }
  }

  const partidasDev = await dev.partidaCatalog.findMany({
    where: { id: { in: Array.from(partidaDevIds) } },
  });

  const partidaMap = new Map<string, string>();
  let partidasCreadas = 0;
  let partidasMatched = 0;

  for (const p of partidasDev) {
    const prodMatch = await prod.partidaCatalog.findFirst({
      where: { category: p.category, name: p.name },
    });
    if (prodMatch) {
      partidaMap.set(p.id, prodMatch.id);
      partidasMatched++;
      continue;
    }
    console.log(`  ${tag()} crear partida: ${p.category} | ${p.name}`);
    if (APPLY) {
      const created = await prod.partidaCatalog.create({
        data: {
          category: p.category,
          name: p.name,
          descriptionCliente: p.descriptionCliente,
          descriptionMaestro: p.descriptionMaestro,
          sortOrder: p.sortOrder,
          unit: p.unit,
          unitPrice: p.unitPrice,
          costMaterial: p.costMaterial,
          costLabor: p.costLabor,
          costTools: p.costTools,
          costMargin: p.costMargin,
          costLoss: p.costLoss,
          costSubcontract: p.costSubcontract,
        },
      });
      partidaMap.set(p.id, created.id);
    } else {
      partidaMap.set(p.id, `[NEW-${p.id.slice(-6)}]`);
    }
    partidasCreadas++;
  }
  console.log(
    `  Total: ${partidasDev.length} | Matched: ${partidasMatched} | Creadas: ${partidasCreadas}`
  );

  // ===== FASE 2: BudgetVersion =====
  console.log(`\n=== FASE 2: BudgetVersions ===`);

  const bvMap = new Map<string, string>();
  for (const bv of bvsDev) {
    console.log(
      `  ${tag()} crear BV ${bv.version} type=${bv.type} status=${bv.status} GG=${bv.ggPercentage} Util=${bv.utilityPercentage}`
    );
    if (APPLY) {
      const created = await prod.budgetVersion.create({
        data: {
          projectId: rosasProd.id,
          version: bv.version,
          parentVersionId: null,
          date: bv.date,
          status: bv.status,
          type: bv.type,
          observations: bv.observations,
          ggPercentage: bv.ggPercentage,
          utilityPercentage: bv.utilityPercentage,
          discountPercentage: bv.discountPercentage,
        },
      });
      bvMap.set(bv.id, created.id);
    } else {
      bvMap.set(bv.id, `[NEW-BV-${bv.type}]`);
    }
  }

  // ===== FASE 3: ObraItems =====
  console.log(`\n=== FASE 3: ObraItems ===`);
  let obraItemsCreados = 0;
  for (const bv of bvsDev) {
    for (const item of bv.obraItems) {
      const newCatPartidaId = item.catalogPartidaId
        ? partidaMap.get(item.catalogPartidaId)
        : null;
      const newBvId = bvMap.get(bv.id)!;
      if (item.catalogPartidaId && !newCatPartidaId) {
        throw new Error(`No hay mapping para partida ${item.catalogPartidaId}`);
      }

      console.log(
        `  ${tag()} item ${item.itemNumber} ${item.name} (${item.chapter}) total=${item.total}`
      );

      if (APPLY) {
        await prod.obraItem.create({
          data: {
            budgetVersionId: newBvId,
            lineageId: item.lineageId,
            chapter: item.chapter,
            itemNumber: item.itemNumber,
            name: item.name,
            descriptionCliente: item.descriptionCliente,
            descriptionMaestro: item.descriptionMaestro,
            unit: item.unit,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
            costMaterial: item.costMaterial,
            costLabor: item.costLabor,
            costSubcontract: item.costSubcontract,
            costMargin: item.costMargin,
            costTools: item.costTools,
            costLoss: item.costLoss,
            sortOrder: item.sortOrder,
            catalogPartidaId:
              newCatPartidaId && !newCatPartidaId.startsWith("[")
                ? newCatPartidaId
                : null,
            isCustomized: item.isCustomized,
          },
        });
      }
      obraItemsCreados++;
    }
  }
  console.log(`  ${tag()} obraItems creados: ${obraItemsCreados}`);

  console.log(`\n${tag()} Replicación terminada.`);
  if (!APPLY) console.log(`Re-correr con --apply para escribir en prod.`);

  await dev.$disconnect();
  await prod.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
