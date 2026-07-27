/**
 * Convierte el PDF del Estado de Pago a IMAGEN, con el mismo html que usa el
 * generador de verdad (renderEPHtml).
 *
 * Uso: npx tsx scripts/verify-ep-pdf-imagen.ts <estadoPagoId> <archivo.png>
 */
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { readFileSync, mkdirSync } from "fs";
import { renderEPHtml } from "../src/lib/pdf/EstadoPagoPDF.html";

const EP_ID = process.argv[2]!;
const SALIDA = process.argv[3] ?? "scripts/_capturas/ep.png";

const env = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const url = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  const ep = await prisma.estadoPago.findUnique({
    where: { id: EP_ID },
    include: {
      project: true,
      maestro: true,
      items: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!ep) throw new Error("EP no encontrado");

  const totalLaborBudget = ep.items.reduce((s, i) => s + i.laborTotal, 0);
  const items = ep.items.map((i) => ({
    chapterName: i.chapterName,
    chapterOrder: i.chapterOrder,
    subChapter: i.subChapter,
    sortOrder: i.sortOrder,
    itemNumber: i.itemNumber,
    name: i.name,
    descriptionMaestro: i.descriptionMaestro,
    unit: i.unit,
    quantity: i.quantity,
    laborUnitPrice: i.laborUnitPrice,
    pctAccumulated: i.pctAccumulated,
    amountThisEp: i.quantityExecuted * i.laborUnitPrice,
    totalAccumulated: i.quantityExecuted * i.laborUnitPrice,
    quantityExecuted: i.quantityExecuted,
    outOfScope: i.outOfScope,
  }));

  const html = renderEPHtml({
    project: ep.project,
    ep: { number: ep.number, date: ep.date, status: ep.status, notes: ep.notes },
    maestro: ep.maestro ? { name: ep.maestro.name } : null,
    items,
    previousEps: [],
    totalLaborBudget,
    totalAmountThisEp: items.reduce((s, i) => s + i.amountThisEp, 0),
  } as never);

  mkdirSync("scripts/_capturas", { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1100, height: 1400 },
    deviceScaleFactor: 2,
  });
  await page.emulateMedia({ media: "print" });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  const capitulos = await page.$$eval(".chapter-row", (filas) =>
    filas.map((f) => f.textContent!.replace(/\s+/g, " ").trim())
  );
  console.log("capítulos en el PDF del EP:");
  for (const c of capitulos) console.log(`  ${c}`);

  const tabla = page.locator("table.partidas").first();
  await tabla.screenshot({ path: SALIDA });
  console.log(`imagen: ${SALIDA}`);
  await browser.close();
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
