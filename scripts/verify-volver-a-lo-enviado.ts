/**
 * Verifica "volver a lo enviado" con capítulos de nombre libre.
 *
 * La foto de la versión enviada guarda el NOMBRE del capítulo de cada partida,
 * no su id: al restaurar, los capítulos pueden haberse renombrado o borrado, y
 * un id apuntando a nada dejaría la partida huérfana. Este script comprueba
 * que, después de romper los capítulos a propósito, restaurar devuelve cada
 * partida a un capítulo con el nombre que tenía.
 *
 * Uso: npx tsx scripts/verify-volver-a-lo-enviado.ts <baseUrl> <budgetVersionId>
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { buildBudgetSnapshot, restoreObraFromSnapshot } from "../src/lib/catalog/budgetSnapshot";

const BV = process.argv[3] ?? "cmoxk6zdf001drtr4ydd9ljgx";
const env = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const url = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const prisma = new PrismaClient({ datasources: { db: { url } } });

const chequeos: [string, boolean, string][] = [];
function chequeo(n: string, ok: boolean, d = "") {
  chequeos.push([n, ok, d]);
  console.log(`  ${ok ? "OK  " : "FALLA"} ${n}${d ? " — " + d : ""}`);
}

// Nombre del capítulo de cada partida, indexado por lineageId.
async function fotoActual() {
  const bv = await prisma.budgetVersion.findUnique({
    where: { id: BV },
    include: { obraChapters: true, obraItems: true },
  });
  const nombre = new Map(bv!.obraChapters.map((c) => [c.id, c.name]));
  return new Map(
    bv!.obraItems.map((i) => [
      i.lineageId,
      i.chapterId ? nombre.get(i.chapterId) ?? "(?)" : "(sin capítulo)",
    ])
  );
}

async function main() {
  console.log("\n1) Guardar la foto de 'lo enviado'");
  const snap = await buildBudgetSnapshot(BV);
  await prisma.budgetVersion.update({
    where: { id: BV },
    data: { sentSnapshot: snap as never, sentAt: new Date(), type: "obra" },
  });
  const antes = await fotoActual();
  console.log(`   ${antes.size} partidas fotografiadas`);

  console.log("\n2) Romper los capítulos a propósito (renombrar y borrar uno vacío)");
  const caps = await prisma.obraChapter.findMany({
    where: { budgetVersionId: BV },
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { items: true } } },
  });
  const conPartidas = caps.find((c) => c._count.items > 0)!;
  await prisma.obraChapter.update({
    where: { id: conPartidas.id },
    data: { name: "NOMBRE CAMBIADO A PROPOSITO" },
  });
  console.log(`   "${conPartidas.name}" renombrado a "NOMBRE CAMBIADO A PROPOSITO"`);

  console.log("\n3) Volver a lo enviado");
  await restoreObraFromSnapshot(BV);
  const despues = await fotoActual();

  chequeo(
    "vuelven todas las partidas",
    antes.size === despues.size,
    `${despues.size} de ${antes.size}`
  );
  const malUbicadas = [...antes.entries()].filter(
    ([lin, cap]) => despues.get(lin) !== cap
  );
  chequeo(
    "cada partida vuelve a un capítulo con el mismo nombre",
    malUbicadas.length === 0,
    malUbicadas.length > 0
      ? `${malUbicadas.length} mal ubicadas: ${malUbicadas
          .slice(0, 3)
          .map(([l, c]) => `${c} → ${despues.get(l)}`)
          .join(", ")}`
      : ""
  );
  const sinCapitulo = [...despues.values()].filter((c) => c === "(sin capítulo)");
  chequeo("ninguna partida queda sin capítulo", sinCapitulo.length === 0);

  // Limpieza: sacamos la foto de prueba.
  await prisma.budgetVersion.update({
    where: { id: BV },
    data: { sentSnapshot: undefined, sentAt: null },
  });

  const fallas = chequeos.filter(([, ok]) => !ok);
  console.log(`\n=== ${chequeos.length - fallas.length}/${chequeos.length} chequeos OK ===`);
  if (fallas.length > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
