/**
 * Genera los CUATRO documentos del maestro de Casa Los Algarrobos V3 (PDF y
 * Excel, con y sin precios) con los datos reales de la base viva, para revisar
 * el subtotal por capítulo (pendiente 173).
 *
 * Además chequea la cuenta que importa: la suma de los subtotales de capítulo
 * tiene que dar EXACTO el total del pie.
 *
 * Uso: npx tsx scripts/diag-173-subtotales-capitulo.ts .env.prod /tmp/173/forma-a
 */
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import fs from "node:fs";
import {
  renderObraMaestroHTML,
  buildObraMaestroFooter,
} from "../src/lib/pdf/ObraMaestroPDF.html";
import { buildObraMaestroXLSX } from "../src/lib/xlsx/ObraMaestroXLSX";
import { renderPDF } from "../src/lib/pdf/renderPDF";
import { esSinManoDeObra } from "../src/lib/ep/hideNoLabor";
import { groupByChapter } from "../src/lib/presupuesto/chapters";

dotenv.config({ path: process.argv[2] ?? ".env.prod", override: true });

const prisma = new PrismaClient();
const OUT = process.argv[3] ?? "/tmp/173";

async function main() {
  const budget = await prisma.budgetVersion.findFirst({
    where: { project: { numeroProyecto: 65 }, type: "obra", version: "V3" },
    include: {
      project: { include: { maestro: true } },
      obraChapters: { orderBy: { sortOrder: "asc" } },
      obraItems: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!budget) throw new Error("No se encontró Casa Los Algarrobos obra V3");

  const visibles = budget.obraItems.filter(
    (it) => !esSinManoDeObra(it.costLabor ?? 0, it)
  );

  const items = visibles.map((it) => ({
    chapterId: it.chapterId,
    subChapter: it.subChapter,
    sortOrder: it.sortOrder,
    name: it.name,
    descriptionMaestro: it.descriptionMaestro,
    unit: it.unit,
    quantity: it.quantity,
    costLabor: it.costLabor,
  }));

  // ── La cuenta: subtotales vs total del pie ───────────────────────────────
  const grupos = groupByChapter(budget.obraChapters, items);
  let sumaSubtotales = 0;
  console.log("\nSubtotales por capítulo (mano de obra acordada):\n");
  for (const g of grupos) {
    const sub = g.items.reduce(
      (s, i) => s + (i.costLabor ?? 0) * i.quantity,
      0
    );
    sumaSubtotales += sub;
    console.log(
      `  ${String(g.index).padStart(2)}. ${g.chapter.name.padEnd(42)} ` +
        `$ ${Math.round(sub).toLocaleString("es-CL").padStart(12)}` +
        `   (${g.items.length} partidas)`
    );
  }
  const totalPie = items.reduce(
    (s, i) => s + (i.costLabor ?? 0) * i.quantity,
    0
  );
  console.log(
    `\n  ${"SUMA DE LOS SUBTOTALES".padEnd(46)} $ ${Math.round(sumaSubtotales)
      .toLocaleString("es-CL")
      .padStart(12)}`
  );
  console.log(
    `  ${"TOTAL DEL PIE".padEnd(46)} $ ${Math.round(totalPie)
      .toLocaleString("es-CL")
      .padStart(12)}`
  );
  console.log(
    Math.round(sumaSubtotales) === Math.round(totalPie)
      ? "\n  CALZA EXACTO.\n"
      : "\n  *** NO CALZA ***\n"
  );

  const input = {
    project: {
      name: budget.project.name,
      clientName: budget.project.clientName,
      address: budget.project.address,
    },
    budget: { version: budget.version, date: budget.date },
    maestro: budget.project.maestro
      ? { name: budget.project.maestro.name }
      : null,
    chapters: budget.obraChapters,
    items,
  };

  fs.mkdirSync(OUT, { recursive: true });

  for (const conPrecios of [false, true]) {
    const tag = conPrecios ? "CON_PRECIOS" : "SIN_PRECIOS";

    const html = renderObraMaestroHTML({ ...input, conPrecios });
    // Mismas opciones que la ruta de la app, para que el PDF salga idéntico.
    const pdf = await renderPDF(html, {
      format: "A4",
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: buildObraMaestroFooter(budget.version, budget.date),
      margin: { top: "12mm", bottom: "16mm", left: "12mm", right: "12mm" },
    });
    fs.writeFileSync(`${OUT}/Maestro_Algarrobos_V3_${tag}.pdf`, pdf);
    fs.writeFileSync(`${OUT}/Maestro_Algarrobos_V3_${tag}.html`, html);

    const xlsx = await buildObraMaestroXLSX({ ...input, conPrecios });
    fs.writeFileSync(`${OUT}/Maestro_Algarrobos_V3_${tag}.xlsx`, xlsx);

    console.log(`  generado: ${tag} (pdf + xlsx)`);
  }
  console.log(`\nCarpeta: ${OUT}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
