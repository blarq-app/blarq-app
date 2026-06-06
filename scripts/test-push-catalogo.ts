import "dotenv/config";
import { prisma } from "../src/lib/prisma";

/**
 * Regresión del endpoint "↑ al catálogo": subir UNA línea de la cotización a
 * la partida del catálogo crea el PartidaComponent, deja el vínculo
 * (originComponentId) y recalcula los totales del catálogo. Idempotente.
 *
 * Pega contra el server dev en :3000. Crea y borra su data.
 */

const BASE = process.env.SMOKE_BASE || "http://localhost:3000";
let projectId = "";
let partidaCatId = "";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FALLÓ: " + msg);
  console.log("  ✓ " + msg);
}

async function main() {
  // Partida del catálogo (vacía).
  const cat = await prisma.partidaCatalog.create({
    data: { category: "__TEST", name: "__TEST push " + Math.floor(performance.now()), unit: "M2" },
  });
  partidaCatId = cat.id;

  const project = await prisma.project.create({
    data: { name: "__TEST push-cat", clientName: "__TEST" },
  });
  projectId = project.id;
  const bv = await prisma.budgetVersion.create({
    data: { projectId, version: "V1", type: "obra", status: "borrador" },
  });
  // ObraItem vinculado al catálogo, con un material que MJ "agregó" (sin origen).
  const item = await prisma.obraItem.create({
    data: {
      budgetVersionId: bv.id,
      chapter: "terminaciones",
      itemNumber: "1.1",
      name: "__TEST partida",
      unit: "M2",
      quantity: 1,
      unitPrice: 8000,
      total: 8000,
      catalogPartidaId: partidaCatId,
      costMaterial: 8000,
    },
  });
  const comp = await prisma.obraItemComponent.create({
    data: {
      obraItemId: item.id,
      type: "material",
      description: "PORCELANATO 60x60",
      unit: "UN",
      quantity: 4,
      unitCost: 2000,
      totalCost: 8000,
      isCustomized: true,
    },
  });

  console.log("Test — subir una línea al catálogo:");
  const url = `${BASE}/api/presupuestos/${bv.id}/partidas/${item.id}/componentes/${comp.id}/al-catalogo`;
  const r = await fetch(url, { method: "POST" });
  assert(r.ok, "el endpoint respondió 200");

  const catComps = await prisma.partidaComponent.findMany({ where: { partidaId: partidaCatId } });
  assert(catComps.length === 1, "se creó 1 línea en el catálogo");
  assert(catComps[0].description === "PORCELANATO 60x60", "descripción correcta en el catálogo");
  assert(catComps[0].unitCost === 2000 && catComps[0].quantity === 4, "cantidad y precio correctos");

  const compAfter = await prisma.obraItemComponent.findUniqueOrThrow({ where: { id: comp.id } });
  assert(compAfter.originComponentId === catComps[0].id, "quedó el vínculo originComponentId");

  const catAfter = await prisma.partidaCatalog.findUniqueOrThrow({ where: { id: partidaCatId } });
  assert(catAfter.costMaterial === 8000, "catálogo recalculado: costMaterial $8.000");
  assert(catAfter.unitPrice === 8000, "catálogo recalculado: P.U. $8.000");

  console.log("Test — idempotente (re-subir actualiza, no duplica):");
  const r2 = await fetch(url, { method: "POST" });
  assert(r2.ok, "segundo POST respondió 200");
  const catComps2 = await prisma.partidaComponent.findMany({ where: { partidaId: partidaCatId } });
  assert(catComps2.length === 1, "sigue habiendo 1 línea (no duplicó)");

  console.log("\nTODO OK.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (projectId) {
      const items = await prisma.obraItem.findMany({
        where: { budgetVersion: { projectId } },
        select: { id: true },
      });
      await prisma.obraItemComponent.deleteMany({
        where: { obraItemId: { in: items.map((i) => i.id) } },
      });
      await prisma.obraItem.deleteMany({ where: { budgetVersion: { projectId } } });
      await prisma.budgetVersion.deleteMany({ where: { projectId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
    }
    if (partidaCatId) {
      await prisma.partidaComponent.deleteMany({ where: { partidaId: partidaCatId } });
      await prisma.partidaCatalog.deleteMany({ where: { id: partidaCatId } });
    }
    await prisma.$disconnect();
  });
