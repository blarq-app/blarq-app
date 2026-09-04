// Test de regresión de la foto ("volver a lo enviado") — CLAUDE.md §4.2.
//
// Cubre el arreglo del 2026-09-04: la foto ahora guarda `maestroId` y
// `noCobrado`, y el restore preserva `revisado` y los datos de las fotos
// VIEJAS (las sacadas antes del cambio, que no traen esos campos).
//
// Corre contra la base DEV — crea un proyecto de prueba, lo usa y lo borra.
// NUNCA apuntar a la viva: aborta si detecta ep-shy-morning.
//
//   npx tsx scripts/test-budget-snapshot-maestros.ts
//
// Los 3 casos:
//   1. foto NUEVA  → restaura maestro y "no cobrado" tal como estaban al enviar
//   2. foto VIEJA  → no los pisa: preserva los que la partida tiene hoy
//   3. `revisado`  → sobrevive siempre (no viaja en la foto)

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { buildBudgetSnapshot, restoreObraFromSnapshot } from "../src/lib/catalog/budgetSnapshot";

if (/ep-shy-morning/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("ABORTO: este test escribe y borra — nunca contra la base viva");
}

let fallas = 0;
function chequear(rotulo: string, real: unknown, esperado: unknown) {
  const ok = real === esperado;
  if (!ok) fallas++;
  console.log(`   ${ok ? "OK  " : "FALLA"} ${rotulo}: ${JSON.stringify(real)}${ok ? "" : ` (esperaba ${JSON.stringify(esperado)})`}`);
}

async function main() {
  console.log("base:", (process.env.DATABASE_URL ?? "").match(/ep-[a-z-]+-\w+/)?.[0]);

  const maestro = await prisma.maestro.create({ data: { name: `TEST maestro ${Date.now()}` } });
  const proyecto = await prisma.project.create({
    data: { name: `TEST snapshot ${Date.now()}`, clientName: "TEST", status: "cotizacion" },
  });
  const version = await prisma.budgetVersion.create({
    data: { projectId: proyecto.id, version: "V1", type: "obra", status: "borrador", ggPercentage: 20, utilityPercentage: 10 },
  });
  const capitulo = await prisma.obraChapter.create({
    data: { budgetVersionId: version.id, name: "DEMOLICIONES", sortOrder: 0 },
  });

  // Tres partidas: una con maestro, una absorbida, una marcada como revisada.
  const base = {
    budgetVersionId: version.id, chapterId: capitulo.id, chapter: "",
    unit: "GL", quantity: 1, unitPrice: 1000, total: 1000,
  };
  const conMaestro = await prisma.obraItem.create({
    data: { ...base, itemNumber: "1.1", name: "CON MAESTRO", sortOrder: 0, maestroId: maestro.id },
  });
  const absorbida = await prisma.obraItem.create({
    data: { ...base, itemNumber: "1.2", name: "ABSORBIDA", sortOrder: 1, noCobrado: true },
  });
  const revisada = await prisma.obraItem.create({
    data: { ...base, itemNumber: "1.3", name: "REVISADA", sortOrder: 2, revisado: true },
  });
  const lineages = {
    conMaestro: (await prisma.obraItem.findUniqueOrThrow({ where: { id: conMaestro.id }, select: { lineageId: true } })).lineageId,
    absorbida: (await prisma.obraItem.findUniqueOrThrow({ where: { id: absorbida.id }, select: { lineageId: true } })).lineageId,
    revisada: (await prisma.obraItem.findUniqueOrThrow({ where: { id: revisada.id }, select: { lineageId: true } })).lineageId,
  };

  const leer = async () => {
    const items = await prisma.obraItem.findMany({
      where: { budgetVersionId: version.id },
      select: { lineageId: true, name: true, maestroId: true, noCobrado: true, revisado: true, total: true },
    });
    return new Map(items.map((i) => [i.lineageId, i]));
  };

  try {
    // ---------- CASO 1: foto NUEVA ----------
    console.log("\n1. foto NUEVA (guarda maestro y 'no cobrado')");
    const fotoNueva = await buildBudgetSnapshot(version.id);
    await prisma.budgetVersion.update({
      where: { id: version.id }, data: { sentSnapshot: fotoNueva as object, status: "enviado", sentAt: new Date() },
    });
    const enFoto = fotoNueva.obraItems.find((i) => i.lineageId === lineages.conMaestro);
    chequear("la foto guarda el maestro", enFoto?.maestroId, maestro.id);
    chequear("la foto guarda 'no cobrado'", fotoNueva.obraItems.find((i) => i.lineageId === lineages.absorbida)?.noCobrado, true);

    // Simular ediciones a mano: sacar el maestro, desmarcar lo absorbido y
    // cambiar un precio — es lo que "volver a lo enviado" tiene que deshacer.
    await prisma.obraItem.update({ where: { id: conMaestro.id }, data: { maestroId: null, total: 9999 } });
    await prisma.obraItem.update({ where: { id: absorbida.id }, data: { noCobrado: false } });

    await restoreObraFromSnapshot(version.id);
    let post = await leer();
    chequear("el maestro vuelve", post.get(lineages.conMaestro)?.maestroId, maestro.id);
    chequear("el precio editado vuelve", post.get(lineages.conMaestro)?.total, 1000);
    chequear("'no cobrado' vuelve", post.get(lineages.absorbida)?.noCobrado, true);
    chequear("'revisado' sobrevive", post.get(lineages.revisada)?.revisado, true);

    // ---------- CASO 2: foto VIEJA (sin los campos nuevos) ----------
    console.log("\n2. foto VIEJA (formato anterior al 2026-09-04)");
    const fotoVieja = JSON.parse(JSON.stringify(fotoNueva));
    for (const it of fotoVieja.obraItems) { delete it.maestroId; delete it.noCobrado; }
    await prisma.budgetVersion.update({ where: { id: version.id }, data: { sentSnapshot: fotoVieja } });

    // Los ids cambiaron con el restore anterior: reasignar por lineageId.
    const ahora = await leer();
    const idDe = async (lin: string) =>
      (await prisma.obraItem.findFirstOrThrow({ where: { budgetVersionId: version.id, lineageId: lin }, select: { id: true } })).id;
    await prisma.obraItem.update({ where: { id: await idDe(lineages.conMaestro) }, data: { maestroId: maestro.id } });
    await prisma.obraItem.update({ where: { id: await idDe(lineages.absorbida) }, data: { noCobrado: true } });
    await prisma.obraItem.update({ where: { id: await idDe(lineages.revisada) }, data: { revisado: true } });
    console.log(`   (estado previo: maestro=${!!ahora.get(lineages.conMaestro)?.maestroId})`);

    await restoreObraFromSnapshot(version.id);
    post = await leer();
    chequear("el maestro NO se pierde con una foto vieja", post.get(lineages.conMaestro)?.maestroId, maestro.id);
    chequear("'no cobrado' NO se pierde con una foto vieja", post.get(lineages.absorbida)?.noCobrado, true);
    chequear("'revisado' sobrevive", post.get(lineages.revisada)?.revisado, true);

    // ---------- CASO 3: la foto nueva manda cuando dice "sin maestro" ----------
    console.log("\n3. una foto NUEVA que dice 'sin maestro' se respeta (no cae al previo)");
    const sinMaestro = JSON.parse(JSON.stringify(fotoNueva));
    for (const it of sinMaestro.obraItems) { it.maestroId = null; it.noCobrado = false; }
    await prisma.budgetVersion.update({ where: { id: version.id }, data: { sentSnapshot: sinMaestro } });
    await prisma.obraItem.update({ where: { id: await idDe(lineages.conMaestro) }, data: { maestroId: maestro.id } });

    await restoreObraFromSnapshot(version.id);
    post = await leer();
    chequear("el null de la foto gana sobre el maestro actual", post.get(lineages.conMaestro)?.maestroId, null);
    chequear("el false de la foto gana", post.get(lineages.absorbida)?.noCobrado, false);
    chequear("'revisado' sigue sobreviviendo", post.get(lineages.revisada)?.revisado, true);
  } finally {
    await prisma.project.delete({ where: { id: proyecto.id } }); // cascade se lleva versión, capítulos y partidas
    await prisma.maestro.delete({ where: { id: maestro.id } });
    console.log("\n(datos de prueba borrados)");
  }

  console.log(fallas === 0 ? "\n✔ TODO OK" : `\n*** ${fallas} FALLAS ***`);
  if (fallas) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
