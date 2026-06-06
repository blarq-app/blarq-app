import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { pushObraItemComponentsToCatalog } from "../src/lib/catalog/pushObraItemToCatalog";
import { recalcObraItemFromComponents } from "../src/lib/catalog/recalcObraItem";

/**
 * Regresión del bug "la pérdida no se traspasa al catálogo".
 *
 * Replica el caso real (guardapolvo porcelanato): una partida con desglose que
 * incluye una PÉRDIDA % sobre un material concreto, más mano de obra, leyes,
 * herramientas, subcontrato y margen. Verifica que al subir al catálogo:
 *   - el desglose COMPLETO llega (incluida la pérdida),
 *   - la pérdida queda apuntando al material EN EL CATÁLOGO (no a $0),
 *   - los totales del catálogo quedan IDÉNTICOS a los de la cotización,
 *   - es idempotente (re-subir no duplica ni mueve totales),
 *   - el botón "↑" por línea sobre la pérdida arrastra su material destino.
 *
 * Llama al helper directamente (sin server ni auth). Crea y borra su data.
 * Corre contra dev (ep-solitary-mud). NO toca prod.
 */

const cleanup: { projectIds: string[]; catIds: string[] } = {
  projectIds: [],
  catIds: [],
};

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FALLÓ: " + msg);
  console.log("  ✓ " + msg);
}
function near(a: number, b: number) {
  return Math.abs(a - b) < 0.01;
}

// Arma una partida del catálogo vacía + una cotización en borrador con un
// desglose completo (material, MO, leyes, herramientas, subcontrato, pérdida %
// sobre el material, margen %). Devuelve ids y el total esperado del catálogo
// (= total de la cotización, ya que el desglose es el mismo).
async function armar(nombre: string) {
  const cat = await prisma.partidaCatalog.create({
    data: { category: "__TEST", name: `__TEST ${nombre} ${Math.floor(performance.now())}`, unit: "M2" },
  });
  cleanup.catIds.push(cat.id);

  const project = await prisma.project.create({
    data: { name: "__TEST al-catalogo-perdida", clientName: "__TEST" },
  });
  cleanup.projectIds.push(project.id);
  const bv = await prisma.budgetVersion.create({
    data: { projectId: project.id, version: "V1", type: "obra", status: "borrador" },
  });
  const item = await prisma.obraItem.create({
    data: {
      budgetVersionId: bv.id,
      chapter: "terminaciones",
      itemNumber: "1.1",
      name: "Instalación guardapolvo porcelanato",
      unit: "ML",
      quantity: 1,
      unitPrice: 0,
      total: 0,
      catalogPartidaId: cat.id,
    },
  });

  // Material (sobre el que aplica la pérdida).
  const mat = await prisma.obraItemComponent.create({
    data: {
      obraItemId: item.id, type: "material", description: "Guardapolvo porcelanato",
      unit: "ML", quantity: 10, unitCost: 1000, totalCost: 0, sortOrder: 0,
    },
  });
  // Mano de obra.
  await prisma.obraItemComponent.create({
    data: {
      obraItemId: item.id, type: "mano_obra", description: "Instalación",
      unit: "GL", quantity: 1, unitCost: 5000, totalCost: 0, sortOrder: 1,
    },
  });
  // Leyes sociales (mano de obra como % sobre la MO).
  await prisma.obraItemComponent.create({
    data: {
      obraItemId: item.id, type: "mano_obra", description: "Leyes sociales",
      unit: "%", quantity: 30, unitCost: 0, totalCost: 0,
      appliedToType: "mano_obra", sortOrder: 2,
    },
  });
  // Herramientas + subcontrato.
  await prisma.obraItemComponent.create({
    data: {
      obraItemId: item.id, type: "herramientas", description: "Herramienta menor",
      unit: "GL", quantity: 1, unitCost: 800, totalCost: 0, sortOrder: 3,
    },
  });
  await prisma.obraItemComponent.create({
    data: {
      obraItemId: item.id, type: "subcontrato", description: "Pulido",
      unit: "GL", quantity: 1, unitCost: 1200, totalCost: 0, sortOrder: 4,
    },
  });
  // PÉRDIDA = 5% del material.
  const perd = await prisma.obraItemComponent.create({
    data: {
      obraItemId: item.id, type: "perdida", description: "Pérdida porcelanato",
      unit: "%", quantity: 5, unitCost: 0, totalCost: 0,
      appliedToComponentId: mat.id, sortOrder: 5,
    },
  });
  // Margen = 10% sobre el resto.
  await prisma.obraItemComponent.create({
    data: {
      obraItemId: item.id, type: "margen", description: "Margen",
      unit: "%", quantity: 10, unitCost: 0, totalCost: 0, sortOrder: 6,
    },
  });

  // Recalcular la cotización para fijar los totales esperados.
  await recalcObraItemFromComponents(item.id);
  const itemAfter = await prisma.obraItem.findUniqueOrThrow({ where: { id: item.id } });

  return { catId: cat.id, bvId: bv.id, item: itemAfter, matId: mat.id, perdId: perd.id };
}

async function totalesCatalogo(catId: string) {
  return prisma.partidaCatalog.findUniqueOrThrow({
    where: { id: catId },
    select: {
      unitPrice: true, costMaterial: true, costLabor: true, costTools: true,
      costMargin: true, costLoss: true, costSubcontract: true,
    },
  });
}

async function main() {
  console.log("CASO 1 — botón masivo: subir el desglose COMPLETO\n");
  const c1 = await armar("masivo");

  // Snapshot PRE del catálogo (vacío → todo en 0).
  const pre = await totalesCatalogo(c1.catId);
  console.log("  Catálogo PRE:", JSON.stringify(pre));
  assert(pre.costLoss === 0 && pre.unitPrice === 0, "catálogo arranca vacío (todo en $0)");

  // Pérdida de la cotización = 5% de $10.000 = $500.
  assert(near(c1.item.costLoss ?? 0, 500), "cotización: pérdida = $500 (5% del material)");

  await pushObraItemComponentsToCatalog(c1.item.id);

  const post = await totalesCatalogo(c1.catId);
  console.log("  Catálogo POST:", JSON.stringify(post));

  const comps = await prisma.partidaComponent.findMany({ where: { partidaId: c1.catId } });
  assert(comps.length === 7, "se subieron las 7 líneas del desglose");

  const perd = comps.find((c) => c.type === "perdida");
  assert(!!perd, "la línea de PÉRDIDA está en el catálogo");
  const catMat = comps.find((c) => c.type === "material");
  assert(!!perd!.appliedToComponentId, "la pérdida del catálogo tiene puntero a un material (no null)");
  assert(perd!.appliedToComponentId === catMat!.id, "el puntero apunta al MATERIAL del catálogo (traducido)");
  assert(near(perd!.totalCost, 500), "la pérdida del catálogo vale $500 (NO $0 — bug arreglado)");

  // Totales catálogo == cotización (el desglose es el mismo).
  assert(near(post.costLoss, c1.item.costLoss ?? 0), `costLoss catálogo = cotización ($${post.costLoss})`);
  assert(near(post.costMaterial, c1.item.costMaterial ?? 0), "costMaterial calza");
  assert(near(post.costLabor, c1.item.costLabor ?? 0), "costLabor calza (MO + leyes)");
  assert(near(post.costTools, c1.item.costTools ?? 0), "costTools calza");
  assert(near(post.costSubcontract, c1.item.costSubcontract ?? 0), "costSubcontract calza");
  assert(near(post.costMargin, c1.item.costMargin ?? 0), "costMargin calza");
  assert(near(post.unitPrice, c1.item.unitPrice ?? 0), `unitPrice catálogo = cotización ($${post.unitPrice})`);

  console.log("\n  Idempotencia (re-subir no duplica ni mueve totales):");
  await pushObraItemComponentsToCatalog(c1.item.id);
  const comps2 = await prisma.partidaComponent.findMany({ where: { partidaId: c1.catId } });
  assert(comps2.length === 7, "sigue habiendo 7 líneas (no duplicó)");
  const post2 = await totalesCatalogo(c1.catId);
  assert(near(post2.unitPrice, post.unitPrice) && near(post2.costLoss, post.costLoss), "totales idénticos tras re-subir");

  console.log("\nCASO 2 — botón ↑ por línea sobre SOLO la pérdida\n");
  const c2 = await armar("por-linea");
  // Subir SOLO la línea de pérdida: debe arrastrar su material destino.
  await pushObraItemComponentsToCatalog(c2.item.id, [c2.perdId]);
  const comps3 = await prisma.partidaComponent.findMany({ where: { partidaId: c2.catId } });
  const perd3 = comps3.find((c) => c.type === "perdida");
  const mat3 = comps3.find((c) => c.type === "material");
  assert(!!mat3, "el material destino se subió automáticamente (sin él la pérdida sería $0)");
  assert(!!perd3 && perd3.appliedToComponentId === mat3!.id, "la pérdida apunta al material del catálogo");
  assert(near(perd3!.totalCost, 500), "la pérdida vale $500 (no $0)");
  assert(comps3.length === 2, "solo subió pérdida + su material (no el resto del desglose)");

  console.log("\nTODO OK.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Limpieza: borrar componentes, items, budgets, proyectos y partidas test.
    for (const projectId of cleanup.projectIds) {
      const items = await prisma.obraItem.findMany({
        where: { budgetVersion: { projectId } }, select: { id: true },
      });
      await prisma.obraItemComponent.deleteMany({ where: { obraItemId: { in: items.map((i) => i.id) } } });
      await prisma.obraItem.deleteMany({ where: { budgetVersion: { projectId } } });
      await prisma.budgetVersion.deleteMany({ where: { projectId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
    }
    for (const catId of cleanup.catIds) {
      await prisma.partidaComponent.deleteMany({ where: { partidaId: catId } });
      await prisma.partidaCatalog.deleteMany({ where: { id: catId } });
    }
    await prisma.$disconnect();
  });
