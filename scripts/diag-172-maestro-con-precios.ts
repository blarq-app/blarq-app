/**
 * Genera los CUATRO documentos del maestro de Casa Los Algarrobos V3 con los
 * datos reales de la base viva (mismo camino que los botones de la app):
 * PDF y Excel SIN precios (los de siempre, para ver que no cambiaron) y PDF y
 * Excel CON precios (los nuevos, con la mano de obra acordada).
 *
 * Solo LEE la base. No escribe nada.
 *
 * Uso: npx tsx scripts/diag-172-maestro-con-precios.ts <ruta-env> [carpeta]
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

dotenv.config({ path: process.argv[2], override: true });

const prisma = new PrismaClient();
const OUT = process.argv[3] ?? "/tmp/maestro-172";

function clp(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CL");
}

async function main() {
  // Marcador de la base VIVA (CLAUDE.md §4.9): el proyecto #64 es Paseo del Sena.
  const marcador = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log(`Base: proyecto #64 = ${marcador?.name ?? "(no existe)"}`);
  if (marcador?.name !== "Paseo del Sena") {
    throw new Error("No parece la base viva — abortado");
  }

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

  const base = {
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

  // ─── Chequeo de la regla dura: va costLabor, NUNCA unitPrice ───────────
  const retiro = visibles.find((i) => /RETIRO PISO MADERA/i.test(i.name));
  if (retiro) {
    console.log("\nPartida de control — RETIRO PISO MADERA:");
    console.log(`  cantidad ........... ${retiro.quantity}`);
    console.log(`  M.O. (costLabor) ... ${clp(retiro.costLabor ?? 0)}  <- el que SALE`);
    console.log(`  P.U. cliente ....... ${clp(retiro.unitPrice)}  <- el que NO sale`);
    console.log(
      `  total M.O. ......... ${clp((retiro.costLabor ?? 0) * retiro.quantity)}`
    );
  } else {
    console.log("\nNo encontré la partida RETIRO PISO MADERA");
  }

  const totalMO = items.reduce(
    (s, i) => s + (i.costLabor ?? 0) * i.quantity,
    0
  );
  const totalCliente = visibles.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  console.log(
    `\nPartidas visibles: ${items.length}` +
      `\nTotal mano de obra (lo que sale en el documento): ${clp(totalMO)}` +
      `\nTotal a precio cliente (NO sale): ${clp(totalCliente)}`
  );
  const sinMO = items.filter((i) => !i.costLabor).length;
  console.log(`Partidas visibles con mano de obra en 0: ${sinMO}`);

  fs.mkdirSync(OUT, { recursive: true });
  const nombre = budget.project.name.replace(/\s+/g, "_");

  for (const conPrecios of [false, true]) {
    const tag = conPrecios ? "CON_PRECIOS_" : "";
    const xlsx = await buildObraMaestroXLSX({ ...base, conPrecios });
    const fx = `${OUT}/BLARQ_Cotizacion_Maestro_${tag}${nombre}_${budget.version}.xlsx`;
    fs.writeFileSync(fx, xlsx);

    const html = renderObraMaestroHTML({ ...base, conPrecios });
    const pdf = await renderPDF(html, {
      format: "A4",
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: buildObraMaestroFooter(budget.version, budget.date),
      margin: { top: "12mm", bottom: "16mm", left: "12mm", right: "12mm" },
    });
    const fp = `${OUT}/BLARQ_Cotizacion_Maestro_${tag}${nombre}_${budget.version}.pdf`;
    fs.writeFileSync(fp, pdf);
    console.log(`\n${conPrecios ? "CON precios" : "SIN precios"}:\n  ${fx}\n  ${fp}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
