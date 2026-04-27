/**
 * Migración: corrige el desglose de costos de ObraItems usando proporciones del catálogo.
 *
 * Lógica:
 * - Si costLabor > 0 (ya seteado): mantenerlo, repartir el resto proporcional del catálogo
 * - Si costLabor = 0: repartir TODO proporcional del catálogo (incluyendo labor)
 * - Para items sin catalogPartidaId: mantener lo que existe
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function round(n: number) {
  return Math.round(n);
}

async function main() {
  const obraItems = await prisma.obraItem.findMany({
    where: { catalogPartidaId: { not: null } },
  });

  console.log(`Procesando ${obraItems.length} ObraItems con catalogPartidaId...`);

  let updated = 0;
  let skipped = 0;

  for (const item of obraItems) {
    const catalog = await prisma.partidaCatalog.findUnique({
      where: { id: item.catalogPartidaId! },
    });

    if (!catalog || catalog.unitPrice <= 0) {
      skipped++;
      continue;
    }

    const catLabor = catalog.costLabor ?? 0;
    const catMaterial = catalog.costMaterial ?? 0;
    const catTools = catalog.costTools ?? 0;
    const catMargin = catalog.costMargin ?? 0;
    const catLoss = catalog.costLoss ?? 0;
    const catSubc = catalog.costSubcontract ?? 0;
    const catTotal = catLabor + catMaterial + catTools + catMargin + catLoss + catSubc;

    if (catTotal <= 0) {
      skipped++;
      continue;
    }

    const keepLabor = (item.costLabor ?? 0) > 0;
    const unitPrice = item.unitPrice;

    let newLabor: number;
    let newMaterial: number;
    let newTools: number;
    let newMargin: number;
    let newLoss: number;
    let newSubc: number;

    if (keepLabor) {
      // Mantener costLabor actual, repartir el disponible entre los demás campos
      newLabor = item.costLabor ?? 0;
      const available = unitPrice - newLabor;

      if (available <= 0) {
        // No hay espacio para más campos — todo es labor
        newMaterial = 0;
        newTools = 0;
        newMargin = 0;
        newLoss = 0;
        newSubc = 0;
      } else {
        // Repartir proporcionalmente usando los campos NO-labor del catálogo
        const catNonLabor = catMaterial + catTools + catMargin + catLoss + catSubc;

        if (catNonLabor <= 0) {
          // Catálogo tampoco tiene non-labor — poner todo en material
          newMaterial = available;
          newTools = 0;
          newMargin = 0;
          newLoss = 0;
          newSubc = 0;
        } else {
          const ratio = available / catNonLabor;
          newMaterial = round(catMaterial * ratio);
          newTools = round(catTools * ratio);
          newMargin = round(catMargin * ratio);
          newLoss = round(catLoss * ratio);
          newSubc = round(catSubc * ratio);
          // Ajustar redondeo en material
          const allocatedNonLabor = newMaterial + newTools + newMargin + newLoss + newSubc;
          newMaterial += available - allocatedNonLabor;
        }
      }
    } else {
      // costLabor = 0 → repartir TODO proporcionalmente (incluyendo labor)
      const ratio = unitPrice / catTotal;
      newLabor = round(catLabor * ratio);
      newMaterial = round(catMaterial * ratio);
      newTools = round(catTools * ratio);
      newMargin = round(catMargin * ratio);
      newLoss = round(catLoss * ratio);
      newSubc = round(catSubc * ratio);
      // Ajustar redondeo en material
      const allocated = newLabor + newMaterial + newTools + newMargin + newLoss + newSubc;
      newMaterial += unitPrice - allocated;
    }

    // Verificación
    const newSum = newLabor + newMaterial + newTools + newMargin + newLoss + newSubc;
    if (Math.abs(newSum - unitPrice) > 1) {
      console.warn(`  ⚠️  ${item.name}: sum=${newSum} ≠ unitPrice=${unitPrice}`);
    }

    await prisma.obraItem.update({
      where: { id: item.id },
      data: {
        costLabor: newLabor,
        costMaterial: newMaterial,
        costTools: newTools,
        costMargin: newMargin,
        costLoss: newLoss,
        costSubcontract: newSubc,
      },
    });

    console.log(
      `  ✓ ${item.name.padEnd(45)} | UP=${unitPrice} | mat=${newMaterial} lab=${newLabor} tools=${newTools} margin=${newMargin} loss=${newLoss} subc=${newSubc} | sum=${newSum}`
    );
    updated++;
  }

  console.log(`\nListo: ${updated} actualizados, ${skipped} omitidos.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
