/**
 * Capturas PNG del PDF del maestro (sin y con precios) para revisar el
 * resultado sin abrir el PDF. Renderiza el mismo HTML del PDF a ancho A4.
 *
 * Solo LEE la base. Uso:
 *   npx tsx scripts/diag-172-capturas.ts <ruta-env> [carpeta]
 */
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import puppeteer from "puppeteer";
import { renderObraMaestroHTML } from "../src/lib/pdf/ObraMaestroPDF.html";
import { esSinManoDeObra } from "../src/lib/ep/hideNoLabor";

dotenv.config({ path: process.argv[2], override: true });

const prisma = new PrismaClient();
const OUT = process.argv[3] ?? "scripts/_capturas";

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
    items: visibles.map((it) => ({
      chapterId: it.chapterId,
      subChapter: it.subChapter,
      sortOrder: it.sortOrder,
      name: it.name,
      descriptionMaestro: it.descriptionMaestro,
      unit: it.unit,
      quantity: it.quantity,
      costLabor: it.costLabor,
    })),
  };

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    for (const conPrecios of [false, true]) {
      const page = await browser.newPage();
      // Ancho A4 útil (210mm - 24mm de márgenes) a ~4x para que se lea la letra
      // chica del documento en la captura.
      await page.setViewport({ width: 703, height: 1000, deviceScaleFactor: 4 });
      await page.setContent(renderObraMaestroHTML({ ...base, conPrecios }), {
        waitUntil: "networkidle0",
      });
      await page.evaluate(() => document.fonts.ready);
      // Arriba: encabezado + primeras partidas.
      const arriba = `${OUT}/172-${conPrecios ? "con" : "sin"}-precios-arriba.png`;
      await page.screenshot({
        path: arriba as `${string}.png`,
        clip: { x: 0, y: 0, width: 703, height: 330 },
      });
      // Abajo: la fila de total y la nota al pie.
      const alto = await page.evaluate(() => document.body.scrollHeight);
      const abajo = `${OUT}/172-${conPrecios ? "con" : "sin"}-precios-abajo.png`;
      await page.screenshot({
        path: abajo as `${string}.png`,
        clip: { x: 0, y: Math.max(0, alto - 260), width: 703, height: 260 },
      });
      console.log(`${conPrecios ? "CON" : "SIN"} precios → ${arriba} · ${abajo}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
