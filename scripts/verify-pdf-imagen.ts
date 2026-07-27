/**
 * Convierte el PDF de obra a IMAGEN, para poder mostrárselo a MJ en el chat.
 *
 * Arma el MISMO html que usa el generador del PDF (renderObraHTML) y lo saca
 * como PNG con Chromium en modo impresión. No es una maqueta: es literalmente
 * lo que sale impreso.
 *
 * Uso: npx tsx scripts/verify-pdf-imagen.ts <budgetVersionId> <archivo.png>
 */
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { readFileSync, mkdirSync } from "fs";
import { renderObraHTML } from "../src/lib/pdf/ObraPDF.html";

const BV = process.argv[2]!;
const SALIDA = process.argv[3] ?? "scripts/_capturas/pdf.png";

const env = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const url = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  const budget = await prisma.budgetVersion.findUnique({
    where: { id: BV },
    include: {
      project: true,
      obraChapters: { orderBy: { sortOrder: "asc" } },
      obraItems: { orderBy: { sortOrder: "asc" } },
      paymentTerms: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!budget) throw new Error("versión no encontrada");

  const html = renderObraHTML({
    project: budget.project,
    budget: {
      version: budget.version,
      date: budget.date,
      ggPercentage: budget.ggPercentage,
      utilityPercentage: budget.utilityPercentage,
      coverTitle: budget.coverTitle,
      coverSubtitle: budget.coverSubtitle,
      coverNote: budget.coverNote,
    },
    chapters: budget.obraChapters,
    items: budget.obraItems
      .filter((it) => !it.noCobrado)
      .map((it) => ({ ...it, changeMarker: null })),
    paymentTerms: budget.paymentTerms.map((t) => ({
      stage: t.stage,
      percentage: t.percentage,
    })),
  });

  mkdirSync("scripts/_capturas", { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 900, height: 1200 },
    deviceScaleFactor: 2,
  });
  await page.emulateMedia({ media: "print" });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  // Recortamos la parte que interesa: las páginas con el detalle por capítulo
  // (la portada no aporta nada para revisar los capítulos). Cada bloque de
  // capítulo va en un .chpage.
  const paginas = page.locator(".chpage");
  const cuantas = await paginas.count();
  console.log(`bloques de capítulo en el PDF: ${cuantas}`);
  const primero = await paginas.first().boundingBox();
  const ultimo = await paginas.last().boundingBox();
  if (!primero || !ultimo) throw new Error("no se encontró el detalle");
  await page.screenshot({
    path: SALIDA,
    fullPage: true,
    clip: {
      x: primero.x,
      y: primero.y,
      width: primero.width,
      height: Math.min(ultimo.y + ultimo.height - primero.y, 20000),
    },
  });
  console.log(`imagen: ${SALIDA}`);

  await browser.close();
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
