/**
 * Corrige la errata del capítulo "DEMOLICION" → "DEMOLICIONES".
 *
 * Caso único y verificado: Portofino (#60), presupuesto de obra V7, un solo
 * capítulo con el nombre en singular y 8 partidas adentro. La V6 de la MISMA
 * obra ya lo llama "DEMOLICIONES", así que esto no inventa un nombre: devuelve
 * la V7 a como venía. Es la última pieza suelta que quedó fuera de la
 * homologación del 2026-08-03.
 *
 * OJO — la V7 está APROBADA. El nombre del capítulo sale en el PDF del cliente,
 * así que un PDF regenerado va a decir "DEMOLICIONES". Es corregir una errata
 * (la misma palabra en plural), no cambiar el alcance, y MJ lo pidió sabiendo
 * eso. Por lo mismo NO se toca el otro nombre suelto —"INSTALACIONES SANITARIAS
 * (GASFITERIA, SANITARIO Y GAS)"— que está escrito así a propósito en la V6 y
 * la V7 y es descriptivo, no un error.
 *
 * Lo que NO hace: no toca partidas, ni precios, ni el orden de los capítulos, ni
 * la clave legacy ObraItem.chapter. Solo `ObraChapter.name`. La numeración que
 * ve el cliente se deriva de la POSICIÓN del capítulo, no de su nombre
 * (lib/presupuesto/chapters.ts), así que la numeración del PDF no se mueve.
 *
 * Seguridad: simulacro por defecto; escribir exige `--aplicar --si-la-viva`;
 * verifica el marcador del proyecto #64; ABORTA si la versión ya tuviera además
 * un capítulo "DEMOLICIONES" (ahí no sería un renombre sino una fusión, que es
 * otra decisión). Re-corrible.
 *
 * Correr:
 *   npx tsx scripts/corregir-capitulo-demolicion.ts --si-la-viva
 *   npx tsx scripts/corregir-capitulo-demolicion.ts --si-la-viva --aplicar
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const APLICAR = process.argv.includes("--aplicar");
const VIVA = process.argv.includes("--si-la-viva");

const archivoEnv = VIVA
  ? "/Users/mjblanco/Desktop/blarq-app/.env.prod"
  : "/Users/mjblanco/Desktop/blarq-app/.env";
const URL_DB = readFileSync(archivoEnv, "utf8").match(
  /DATABASE_URL\s*=\s*"?([^"\n]+)"?/
)![1].trim();

const prisma = new PrismaClient({ datasources: { db: { url: URL_DB } } });

const ERRATA = "DEMOLICION";
const CORRECTO = "DEMOLICIONES";

async function main() {
  const host = URL_DB.match(/@([^/:]+)/)?.[1] ?? "?";
  const esViva = host.includes("shy-morning");
  console.log(`Base: ${host} ${esViva ? "(VIVA)" : "(dev)"}`);
  if (VIVA && !esViva) throw new Error("Pediste --si-la-viva pero el host no es el de la viva");
  if (!VIVA && esViva) throw new Error("Sin --si-la-viva no se toca la viva");
  if (esViva) {
    const m = await prisma.project.findFirst({
      where: { numeroProyecto: 64 },
      select: { name: true },
    });
    console.log("Marcador #64:", m?.name);
    if (m?.name !== "Paseo del Sena") throw new Error("El marcador no calza — abortando");
  }
  console.log(APLICAR ? "\nMODO: APLICAR\n" : "\nMODO: simulacro (no escribe)\n");

  const candidatos = await prisma.obraChapter.findMany({
    where: { name: ERRATA },
    include: {
      _count: { select: { items: true } },
      budgetVersion: {
        select: {
          id: true,
          version: true,
          status: true,
          project: { select: { numeroProyecto: true, name: true } },
          obraChapters: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (candidatos.length === 0) {
    console.log(`No hay ningún capítulo llamado "${ERRATA}". Ya está corregido.`);
    return;
  }

  for (const c of candidatos) {
    const bv = c.budgetVersion;
    console.log(
      `· #${bv.project?.numeroProyecto} ${bv.project?.name} · obra ${bv.version} (${bv.status}) · ${c._count.items} partidas`
    );
    // Si la misma versión ya tiene el nombre correcto, renombrar dejaría dos
    // capítulos iguales: eso sería fusionar, y es otra decisión.
    const yaTiene = bv.obraChapters.some((o) => o.id !== c.id && o.name === CORRECTO);
    if (yaTiene) {
      throw new Error(
        `La versión ${bv.version} YA tiene un capítulo "${CORRECTO}". Renombrar dejaría dos iguales: hay que decidir si se fusionan.`
      );
    }
  }
  console.log(`\n${candidatos.length} capítulo(s) a renombrar: "${ERRATA}" → "${CORRECTO}".`);
  console.log("No se toca ninguna partida, ni precios, ni el orden de los capítulos.");

  if (!APLICAR) {
    console.log("\nSimulacro. Para escribir: --si-la-viva --aplicar");
    return;
  }

  const r = await prisma.obraChapter.updateMany({
    where: { name: ERRATA },
    data: { name: CORRECTO },
  });
  console.log(`\nRenombrados: ${r.count}`);

  const quedan = await prisma.obraChapter.count({ where: { name: ERRATA } });
  console.log(`Quedan con la errata: ${quedan}`);
  if (quedan > 0) throw new Error("Quedaron capítulos sin corregir — revisar");

  // Las partidas tienen que seguir todas colgando de su capítulo.
  for (const c of candidatos) {
    const items = await prisma.obraItem.count({ where: { chapterId: c.id } });
    console.log(
      `  ${c.budgetVersion.version}: ${items} partidas en el capítulo (antes ${c._count.items})`
    );
    if (items !== c._count.items) throw new Error("Cambió la cantidad de partidas — revisar");
  }
}

main()
  .catch((e) => {
    console.error("\n" + (e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
