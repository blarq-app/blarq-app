/**
 * Pendiente 155 — recorte del bloque "Observaciones generales" tal como sale
 * impreso, para mostrarlo sin tener que abrir el PDF entero.
 *
 * Renderiza el MISMO html que usa el PDF (no una maqueta) con dos juegos de
 * condiciones: las precargadas y unas editadas a mano.
 *
 *   npx tsx scripts/diag-155-obs-pdf.ts
 */
import { config } from "dotenv";

// Por default lee la base de .env; con `--env .env.prod` se puede renderizar
// el PDF con los datos reales, que es lo que MJ necesita ver para aprobar.
const args = process.argv.slice(2);
const envIdx = args.indexOf("--env");
config({ path: envIdx >= 0 ? args[envIdx + 1] : ".env", override: true });
const FILTRO = args.find((a) => !a.startsWith("--") && a !== args[envIdx + 1]) ?? "Portofino";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";
import { PrismaClient } from "@prisma/client";
import { renderObraHTML } from "../src/lib/pdf/ObraPDF.html";
import { parseCondiciones, type Condicion } from "../src/lib/presupuesto/condiciones";

const prisma = new PrismaClient();
const OUT = path.join(process.cwd(), "scripts", "_capturas-155");


async function main() {
  const v = await prisma.budgetVersion.findFirst({
    where: {
      type: "obra",
      obraItems: { some: {} },
      project: { name: { contains: FILTRO } },
    },
    include: {
      project: true,
      obraChapters: { orderBy: { sortOrder: "asc" } },
      obraItems: { orderBy: { sortOrder: "asc" } },
      paymentTerms: { orderBy: { sortOrder: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!v) throw new Error("No encontré la cotización de obra");

  const precargadas = parseCondiciones(v.conditions) ?? [];
  const editadas: Condicion[] = [
    { text: "PRUEBA 155 (editada a mano): " + precargadas[0].text },
    ...precargadas.slice(1, 3),
    {
      text: "PRUEBA 155 (agregada): los escombros se retiran al final de cada semana de trabajo.",
    },
    ...precargadas.slice(3),
  ];

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 1400, deviceScaleFactor: 3 });

  for (const [nombre, conds] of [
    ["pdf-observaciones-precargadas.png", precargadas],
    ["pdf-observaciones-editadas.png", editadas],
  ] as const) {
    const html = renderObraHTML({
      project: v.project,
      budget: {
        version: v.version,
        date: v.date,
        ggPercentage: v.ggPercentage,
        utilityPercentage: v.utilityPercentage,
        conditions: conds,
        coverTitle: v.coverTitle,
        coverSubtitle: v.coverSubtitle,
        coverNote: v.coverNote,
      },
      chapters: v.obraChapters,
      items: v.obraItems.filter((it) => !it.noCobrado).map((it) => ({ ...it })),
      paymentTerms: v.paymentTerms.map((t) => ({
        stage: t.stage,
        percentage: t.percentage,
      })),
    });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const obs = await page.$(".obs");
    if (!obs) throw new Error("No hay bloque .obs en el PDF");
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
