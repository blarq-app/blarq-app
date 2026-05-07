// Replicación dev → prod del proyecto Arrau (cierre ronda 13).
//
// Copia desde dev a prod:
//   1. Partidas de catálogo nuevas (matcheo por unique [category, name]).
//   2. BudgetVersions del proyecto (V5 obra + V5 artefactos).
//   3. ObraItems con catalogPartidaId remapeado (lineageId preservado).
//   4. ArtefactoItems.
//   5. Facturas con origin maxxa_legacy / maxxa_sin_respaldo / manual.
//   6. Re-asignación projectId/categoryId de las facturas SII que en dev
//      están asignadas a Arrau y en prod no lo están aún.
//   7. Status F-151 → pagada.
//
// NO replica:
//   - El BankMovement ficticio de $14M para F-163.
//   - Componentes de obra (0 en dev para Arrau).
//   - Muebles, chapters, payment terms (0 en dev).
//
// Uso:
//   DATABASE_URL='...dev...' DATABASE_URL_PROD='...prod...' \
//   npx tsx scripts/replicate-arrau-dev-to-prod.ts            # dry-run
//   ... npx tsx scripts/replicate-arrau-dev-to-prod.ts --apply

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const DEV_URL = process.env.DATABASE_URL;
const PROD_URL = process.env.DATABASE_URL_PROD;

if (!DEV_URL || !PROD_URL) { console.error("Faltan DATABASE_URL / DATABASE_URL_PROD"); process.exit(1); }
if (!/ep-solitary-mud/.test(DEV_URL)) { console.error("DATABASE_URL no parece dev"); process.exit(1); }
if (!/ep-shy-morning/.test(PROD_URL)) { console.error("DATABASE_URL_PROD no parece prod"); process.exit(1); }

const dev = new PrismaClient({ datasources: { db: { url: DEV_URL } } });
const prod = new PrismaClient({ datasources: { db: { url: PROD_URL } } });

function tag() { return APPLY ? "[APPLY]" : "[DRY-RUN]"; }

async function main() {
  console.log(`${tag()} Iniciando replicación Arrau dev → prod`);

  const arrauDev = await dev.project.findFirst({ where: { name: { contains: "Arrau" } } });
  const arrauProd = await prod.project.findFirst({ where: { name: { contains: "Arrau" } } });
  if (!arrauDev || !arrauProd) throw new Error("Falta Arrau en alguna BD");

  // ===== FASE 1: PartidaCatalog =====
  console.log(`\n=== FASE 1: PartidaCatalog ===`);

  const bvsDev = await dev.budgetVersion.findMany({
    where: { projectId: arrauDev.id },
    include: { obraItems: true, artefactoItems: true },
  });

  const partidaDevIds = new Set<string>();
  for (const bv of bvsDev) for (const it of bv.obraItems) if (it.catalogPartidaId) partidaDevIds.add(it.catalogPartidaId);

  const partidasDev = await dev.partidaCatalog.findMany({
    where: { id: { in: Array.from(partidaDevIds) } },
  });

  const partidaMap = new Map<string, string>();
  let partidasCreadas = 0;
  let partidasMatched = 0;

  for (const p of partidasDev) {
    // Match por unique key (category, name)
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
  console.log(`  Total: ${partidasDev.length} | Matched: ${partidasMatched} | Creadas: ${partidasCreadas}`);

  // ===== FASE 2: BudgetVersion =====
  console.log(`\n=== FASE 2: BudgetVersions ===`);

  const bvMap = new Map<string, string>();
  for (const bv of bvsDev) {
    console.log(`  ${tag()} crear BV v${bv.version} type=${bv.type} status=${bv.status} GG=${bv.ggPercentage} Util=${bv.utilityPercentage}`);
    if (APPLY) {
      const created = await prod.budgetVersion.create({
        data: {
          projectId: arrauProd.id,
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
      const newCatPartidaId = item.catalogPartidaId ? partidaMap.get(item.catalogPartidaId) : null;
      const newBvId = bvMap.get(bv.id)!;
      if (item.catalogPartidaId && !newCatPartidaId) throw new Error(`No hay mapping para partida ${item.catalogPartidaId}`);

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
            catalogPartidaId: newCatPartidaId && !newCatPartidaId.startsWith("[") ? newCatPartidaId : null,
            isCustomized: item.isCustomized,
          },
        });
      }
      obraItemsCreados++;
    }
  }
  console.log(`  ${tag()} obraItems creados: ${obraItemsCreados}`);

  // ===== FASE 4: ArtefactoItems =====
  console.log(`\n=== FASE 4: ArtefactoItems ===`);
  let artefactosCreados = 0;
  for (const bv of bvsDev) {
    for (const a of bv.artefactoItems) {
      console.log(`  ${tag()} artefacto: ${a.room} | ${a.name} clientPrice=${a.clientPrice}`);
      if (APPLY) {
        const newBvId = bvMap.get(bv.id)!;
        await prod.artefactoItem.create({
          data: {
            budgetVersionId: newBvId,
            room: a.room,
            subcategory: a.subcategory,
            name: a.name,
            detail: a.detail,
            brand: a.brand,
            quantity: a.quantity,
            listPrice: a.listPrice,
            discountPercent: a.discountPercent,
            clientPrice: a.clientPrice,
            realCostBlarq: a.realCostBlarq,
            referenceLink: a.referenceLink,
            sortOrder: a.sortOrder,
          },
        });
      }
      artefactosCreados++;
    }
  }
  console.log(`  Total: ${artefactosCreados}`);

  // ===== FASE 5: Invoices =====
  console.log(`\n=== FASE 5: Invoices a replicar ===`);

  const invsDev = await dev.invoice.findMany({
    where: {
      projectId: arrauDev.id,
      origin: { in: ["maxxa_legacy", "maxxa_sin_respaldo", "manual"] },
    },
  });

  let invsCreated = 0;
  let invsSkipped = 0;
  for (const inv of invsDev) {
    const exists = await prod.invoice.findFirst({
      where: {
        type: inv.type,
        tipoDoc: inv.tipoDoc,
        folioNumber: inv.folioNumber,
        rutIssuer: inv.rutIssuer,
      },
    });
    if (exists) { invsSkipped++; continue; }
    if (APPLY) {
      await prod.invoice.create({
        data: {
          projectId: arrauProd.id,
          type: inv.type,
          tipoDoc: inv.tipoDoc,
          folioNumber: inv.folioNumber,
          rutIssuer: inv.rutIssuer,
          businessName: inv.businessName,
          rutReceiver: inv.rutReceiver,
          issueDate: inv.issueDate,
          dueDate: inv.dueDate,
          netAmount: inv.netAmount,
          iva: inv.iva,
          totalAmount: inv.totalAmount,
          status: inv.status,
          paidAt: inv.paidAt,
          conceptoCobro: inv.conceptoCobro,
          referenceFolioNumber: inv.referenceFolioNumber,
          referenceTipoDoc: inv.referenceTipoDoc,
          compensationType: inv.compensationType,
          appliedToInvoiceId: null,
          refundBankMovementId: null,
          origin: inv.origin,
          siiTrackId: inv.siiTrackId,
          xmlUrl: inv.xmlUrl,
          pdfUrl: inv.pdfUrl,
          syncedAt: inv.syncedAt,
          siiCodigo: inv.siiCodigo,
          notes: inv.notes,
          categoryId: inv.categoryId,
        },
      });
    }
    invsCreated++;
  }
  console.log(`  ${tag()} A crear: ${invsCreated} | Ya existían: ${invsSkipped}`);

  // ===== FASE 6: SII reassignment =====
  console.log(`\n=== FASE 6: SII facturas — reasignar projectId/categoryId ===`);

  const siiDev = await dev.invoice.findMany({
    where: { projectId: arrauDev.id, origin: "sii_automatica" },
  });

  let siiUpdated = 0;
  let siiOk = 0;
  let siiNotFound = 0;
  for (const inv of siiDev) {
    const prodInv = await prod.invoice.findFirst({
      where: {
        type: inv.type,
        tipoDoc: inv.tipoDoc,
        folioNumber: inv.folioNumber,
        rutIssuer: inv.rutIssuer,
      },
    });
    if (!prodInv) { siiNotFound++; continue; }
    if (prodInv.projectId === arrauProd.id && prodInv.categoryId === inv.categoryId) {
      siiOk++;
      continue;
    }
    console.log(`  ${tag()} SII tipo=${inv.tipoDoc} folio=${inv.folioNumber} rut=${inv.rutIssuer}: project ${prodInv.projectId ?? "null"}→Arrau, cat ${prodInv.categoryId ?? "null"}→${inv.categoryId ?? "null"}`);
    if (APPLY) {
      await prod.invoice.update({
        where: { id: prodInv.id },
        data: { projectId: arrauProd.id, categoryId: inv.categoryId },
      });
    }
    siiUpdated++;
  }
  console.log(`  Updated: ${siiUpdated} | OK ya: ${siiOk} | No en prod: ${siiNotFound}`);

  // ===== FASE 7: F-151 status =====
  console.log(`\n=== FASE 7: F-151 → pagada ===`);
  const f151Dev = await dev.invoice.findFirst({
    where: { projectId: arrauDev.id, type: "emitida", folioNumber: "151" },
  });
  if (f151Dev) {
    const f151Prod = await prod.invoice.findFirst({
      where: { type: "emitida", folioNumber: "151", rutIssuer: f151Dev.rutIssuer },
    });
    if (f151Prod && f151Prod.status !== "pagada") {
      console.log(`  ${tag()} F-151 ${f151Prod.status} → pagada paidAt=${f151Dev.paidAt?.toISOString()}`);
      if (APPLY) {
        await prod.invoice.update({
          where: { id: f151Prod.id },
          data: { status: "pagada", paidAt: f151Dev.paidAt },
        });
      }
    } else if (f151Prod) {
      console.log(`  F-151 ya está pagada en prod`);
    }
  }

  console.log(`\n${tag()} Replicación terminada.`);
  if (!APPLY) console.log(`Re-correr con --apply para escribir.`);

  await dev.$disconnect();
  await prod.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
