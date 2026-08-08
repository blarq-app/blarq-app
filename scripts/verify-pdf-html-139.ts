// Captura del PDF del mueblista como IMAGEN (pendiente 139): renderiza el
// MISMO HTML que Puppeteer convierte en PDF y le saca una foto a tamaño A4.
// Es la única vía acá: no hay poppler ni visor de PDF headless.
// Solo lectura sobre la base de DESARROLLO. No escribe nada.
// Uso: npx tsx scripts/verify-pdf-html-139.ts
import { PrismaClient } from "@prisma/client";
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { chromium } from "playwright";
import { renderMueblistaHTML } from "../src/lib/pdf/MueblistaPDF.html";
import { renderMueblesHTML } from "../src/lib/pdf/MueblesPDF.html";

const PRESUPUESTO = "cmot430wx007brtnrgmh4vmra";
const OUT = "scripts/_capturas";

const url = readFileSync(".env", "utf8").match(
  /DATABASE_URL\s*=\s*"?([^"\n]+)"?/,
)![1].trim();
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  mkdirSync(OUT, { recursive: true });

  const budget = await prisma.budgetVersion.findUniqueOrThrow({
    where: { id: PRESUPUESTO },
    include: {
      project: true,
      paymentTerms: { orderBy: { sortOrder: "asc" } },
      muebleChapters: {
        orderBy: { sortOrder: "asc" },
        include: {
          items: {
            orderBy: { sortOrder: "asc" },
            include: {
              herrajes: { orderBy: { sortOrder: "asc" } },
              details: { orderBy: { sortOrder: "asc" } },
            },
          },
        },
      },
    },
  });

  const html = renderMueblistaHTML({
    project: budget.project,
    budget: { version: budget.version, date: budget.date },
    chapters: budget.muebleChapters.map((ch) => ({
      name: ch.name,
      herrajes: ch.items.flatMap((i) =>
        i.herrajes.map((h) => ({
          sector: h.sector,
          name: h.name,
          measure: h.measure,
          finish: h.finish,
          supplier: h.supplier,
          quantity: h.quantity,
        })),
      ),
    })),
  });
  writeFileSync(`${OUT}/_mueblista.html`, html);

  const browser = await chromium.launch();
  // A4 a 96dpi ≈ 794 × 1123 px.
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/139-pdf-mueblista.png` });
  console.log(`foto → ${OUT}/139-pdf-mueblista.png`);

  // Los nombres tal como salen impresos.
  const impresos = await page
    .locator("tbody td:first-child")
    .evaluateAll((els) => els.map((e) => e.textContent!.trim()));
  console.log("nombres impresos en el PDF del mueblista:");
  for (const n of impresos) console.log(`  ${n}`);

  // ── PDF al cliente: los herrajes van dentro del bloque de la partida ──
  const htmlCliente = renderMueblesHTML({
    project: budget.project,
    budget: {
      version: budget.version,
      date: budget.date,
      observations: budget.observations,
      coverTitle: budget.coverTitle,
      coverSubtitle: budget.coverSubtitle,
      coverNote: budget.coverNote,
    },
    chapters: budget.muebleChapters.map((ch) => ({
      chapterNumber: ch.chapterNumber,
      name: ch.name,
      items: ch.items.map((i) => ({
        itemNumber: i.itemNumber,
        name: i.name,
        descriptionGeneral: i.descriptionGeneral,
        quantity: i.quantity,
        clientPriceIva: i.clientPriceIva,
        details: i.details.map((d) => ({ name: d.name, material: d.material })),
        herrajes: i.herrajes.map((h) => ({
          sector: h.sector,
          name: h.name,
          measure: h.measure,
          finish: h.finish,
          quantity: h.quantity,
        })),
      })),
    })),
    paymentTerms: budget.paymentTerms.map((t) => ({
      stage: t.stage,
      percentage: t.percentage,
    })),
  });
  writeFileSync(`${OUT}/_cliente.html`, htmlCliente);
  await page.setContent(htmlCliente, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  // La partida de herrajes vive en la 2a página del documento.
  const bloque = page.locator(".hrow").first();
  await bloque.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/139-pdf-cliente.png` });
  console.log(`\nfoto → ${OUT}/139-pdf-cliente.png`);
  const impresosCliente = await page
    .locator(".hname")
    .evaluateAll((els) => els.map((e) => e.textContent!.trim()));
  console.log("nombres impresos en el PDF al cliente:");
  for (const n of impresosCliente) console.log(`  ${n}`);

  await browser.close();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("ERROR:", e);
  await prisma.$disconnect();
  process.exit(1);
});
