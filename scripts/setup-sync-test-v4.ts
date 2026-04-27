// Repurpuesto: ya no creamos V6 sintética. Lefevre tiene V4 (borrador) y V5
// (aprobado) con diferencias reales. Para probar el modal de sync:
//   - Reconciliamos lineageId entre V4 y V5 matcheando por (chapter, name).
//   - Asociamos EP #1 a V4, snapshot items desde V4.
//   - V5 queda como "versión más nueva" → el badge "Sincronizar con V5" aparece.
import { prisma } from "../src/lib/prisma";

async function main() {
  const projectId = "cmnx59uvq0000rty9ouec5i25";

  // 1) Si quedó V6 sintética de pruebas previas, borrarla
  await prisma.budgetVersion.deleteMany({
    where: { projectId, type: "obra", version: "V6" },
  });

  const v4 = await prisma.budgetVersion.findFirst({
    where: { projectId, type: "obra", version: "V4" },
    include: { obraItems: true },
  });
  const v5 = await prisma.budgetVersion.findFirst({
    where: { projectId, type: "obra", version: "V5" },
    include: { obraItems: true },
  });
  if (!v4 || !v5) throw new Error("Se esperaba V4 y V5 de Lefevre");

  // 2) Reconciliar lineageId: V4 hereda el lineageId de V5 cuando hay match por
  //    (chapter, name). Esto permite que el sync las trate como la misma partida.
  const v5ByKey = new Map<string, string>();
  for (const it of v5.obraItems) {
    v5ByKey.set(`${it.chapter}::${it.name}`, it.lineageId);
  }
  let reconciled = 0;
  for (const it of v4.obraItems) {
    const key = `${it.chapter}::${it.name}`;
    const targetLineage = v5ByKey.get(key);
    if (targetLineage && it.lineageId !== targetLineage) {
      await prisma.obraItem.update({
        where: { id: it.id },
        data: { lineageId: targetLineage },
      });
      reconciled++;
    }
  }

  // 3) Reset EP #1: asociar a V4, regenerar items desde V4
  const ep = await prisma.estadoPago.findFirst({
    where: { projectId, number: 1 },
  });
  if (!ep) throw new Error("Falta EP #1 de Lefevre");
  if (ep.status === "cerrado") {
    throw new Error("EP #1 cerrado; no se puede resetear");
  }

  await prisma.estadoPagoItem.deleteMany({ where: { estadoPagoId: ep.id } });
  await prisma.estadoPago.update({
    where: { id: ep.id },
    data: { budgetVersionId: v4.id },
  });

  // Volver a leer V4 para tener los lineageIds reconciliados
  const v4Fresh = await prisma.obraItem.findMany({
    where: { budgetVersionId: v4.id },
    orderBy: { sortOrder: "asc" },
  });
  for (let idx = 0; idx < v4Fresh.length; idx++) {
    const it = v4Fresh[idx];
    const laborUnitPrice = it.costLabor ?? 0;
    await prisma.estadoPagoItem.create({
      data: {
        estadoPagoId: ep.id,
        obraItemId: it.id,
        lineageId: it.lineageId,
        chapter: it.chapter,
        itemNumber: it.itemNumber,
        name: it.name,
        descriptionMaestro: it.descriptionMaestro,
        unit: it.unit,
        quantity: it.quantity,
        laborUnitPrice,
        laborTotal: laborUnitPrice * it.quantity,
        quantityExecuted: 0,
        pctAccumulated: 0,
        sortOrder: it.sortOrder ?? idx,
      },
    });
  }

  console.log(`Reconciliados ${reconciled} lineageId V4 ↔ V5 por (chapter, name)`);
  console.log(`EP #1 asociado a V4 con ${v4Fresh.length} partidas en borrador`);
  console.log(`V5 (aprobada) queda como versión más nueva → badge de sync activo`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
