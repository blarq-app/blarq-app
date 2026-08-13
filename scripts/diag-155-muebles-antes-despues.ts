/**
 * Pendiente 155 — el antes/después del PDF de muebles de una cotización que
 * tenía las condiciones tipeadas a mano en el campo viejo.
 *
 * ANTES: el PDF imprimía las 5 condiciones fijas del código Y, colgando abajo,
 *        todo el contenido del campo `observations` — que en estas cotizaciones
 *        era ESE MISMO TEXTO tipeado a mano. Salía duplicado.
 * DESPUÉS: imprime la lista de la versión, y nada más.
 *
 *   npx tsx scripts/diag-155-muebles-antes-despues.ts
 */
import "dotenv/config";
import path from "node:path";
import puppeteer from "puppeteer";
import { PrismaClient } from "@prisma/client";
import { renderMueblesHTML } from "../src/lib/pdf/MueblesPDF.html";
import { parseCondiciones, type Condicion } from "../src/lib/presupuesto/condiciones";

const prisma = new PrismaClient();
const OUT = path.join(process.cwd(), "scripts", "_capturas-155");

async function main() {
  const v = await prisma.budgetVersion.findFirst({
    where: { type: "muebles", observations: { not: null }, muebleChapters: { some: {} } },
    include: {
      project: true,
      muebleChapters: {
        orderBy: { sortOrder: "asc" },
        include: {
          items: {
            orderBy: { sortOrder: "asc" },
            include: {
              details: { orderBy: { sortOrder: "asc" } },
              herrajes: { orderBy: { sortOrder: "asc" } },
            },
          },
        },
      },
      paymentTerms: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!v) throw new Error("No encontré una cotización de muebles con observations");
  console.log(`${v.project.name} · muebles ${v.version}`);
  console.log(`observations viejo: ${v.observations?.length} caracteres`);

  const despues = parseCondiciones(v.conditions) ?? [];
  // Reconstrucción de lo que imprimía el código viejo: las fijas + el campo
  // entero como un ítem más al final.
  const antes: Condicion[] = [
    ...despues,
    { text: v.observations!.trim() },
  ];

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 1600, deviceScaleFactor: 3 });

  for (const [nombre, conds] of [
    ["muebles-obs-antes.png", antes],
    ["muebles-obs-despues.png", despues],
  ] as const) {
    const html = renderMueblesHTML({
      project: v.project,
      budget: {
        version: v.version,
        date: v.date,
        conditions: conds,
        coverTitle: v.coverTitle,
        coverSubtitle: v.coverSubtitle,
        coverNote: v.coverNote,
      },
      chapters: v.muebleChapters.map((ch) => ({
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
      paymentTerms: v.paymentTerms.map((t) => ({
        stage: t.stage,
        percentage: t.percentage,
      })),
    });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const obs = await page.$(".obs");
    if (!obs) throw new Error("No hay bloque .obs");
    await obs.screenshot({ path: path.join(OUT, nombre) as `${string}.png` });
    console.log(`· ${nombre}`);
  }
  await browser.close();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
