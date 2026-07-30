/**
 * Vuelca las partidas de la obra V6 de Portofino (#60) desde la base VIVA.
 * Sirve para dos cosas: (a) aprender las convenciones con que se cargó V6
 * (claves de capítulo, itemNumber, subChapter, dónde va la MO) y (b) tener el
 * snapshot ANTES de cargar V7.
 *
 * NO usa dotenv — datasource explícito desde `.env.prod` (§4.9). Solo LEE.
 */
import { readFileSync, writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const ENV_PROD = "/Users/mjblanco/Desktop/blarq-app/.env.prod";
const url = readFileSync(ENV_PROD, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("DATABASE_URL="))!
  .slice("DATABASE_URL=".length)
  .replace(/^["']|["']$/g, "");
const host = url.match(/@([^/]+)\//)?.[1] ?? "???";
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  console.log("HOST:", host);
  const v = await prisma.budgetVersion.findFirst({
    where: { project: { numeroProyecto: 60 }, type: "obra", version: "V6" },
    include: {
      obraChapters: { orderBy: { sortOrder: "asc" } },
      obraItems: {
        orderBy: { sortOrder: "asc" },
        include: { components: true, chapterRel: true },
      },
    },
  });
  if (!v) throw new Error("no hay obra V6");
  console.log(`V6 id=${v.id} gg=${v.ggPercentage} util=${v.utilityPercentage}`);
  console.log("CAPS:", v.obraChapters.map((c) => `${c.sortOrder}=${c.name}`).join(" | "));
  console.log(
    "\nsort | itemNumber | chapter(txt) | chapterRel | subChapter | unidad | cant | P.U | total | costLabor | costMaterial | otros | comps | noCob"
  );
  for (const i of v.obraItems) {
    const otros =
      (i.costTools ?? 0) + (i.costSubcontract ?? 0) + (i.costMargin ?? 0) + (i.costLoss ?? 0);
    console.log(
      [
        i.sortOrder,
        i.itemNumber,
        i.chapter,
        i.chapterRel?.name ?? "-",
        i.subChapter ?? "-",
        i.unit,
        i.quantity,
        Math.round(i.unitPrice),
        Math.round(i.total),
        Math.round(i.costLabor ?? 0),
        Math.round(i.costMaterial ?? 0),
        Math.round(otros),
        i.components.length,
        i.noCobrado ? "SÍ" : "",
        i.name,
      ].join(" | ")
    );
  }
  writeFileSync(
    "/private/tmp/claude-501/-Users-mjblanco-Desktop-blarq-app/322f2d89-4cde-4d41-9f3e-919656befb73/scratchpad/portofino-v6-snapshot.json",
    JSON.stringify(v, null, 2)
  );
  console.log("\nsnapshot JSON guardado.");
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
