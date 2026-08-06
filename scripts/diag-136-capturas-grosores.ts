/**
 * Pendiente 136 — capturas para que MJ elija el grosor de la línea de capítulo.
 *
 * SOLO LECTURA sobre la base viva. Toma la cotización de obra de Casa Los
 * Algarrobos V1, renderiza el mismo HTML que sale al PDF con cada grosor de
 * `.cap { border-bottom }`, y saca:
 *   - una captura del arranque de la hoja de detalle por cada grosor;
 *   - una lámina comparativa con las cuatro, rotuladas.
 *
 * Correr (con DATABASE_URL apuntando a la viva):
 *   npx tsx scripts/diag-136-capturas-grosores.ts
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";
import { renderObraHTML } from "../src/lib/pdf/ObraPDF.html";
import {
  getObraBaselineItems,
  computeChangeMarkers,
} from "../src/lib/presupuesto/versionDiff";

const prisma = new PrismaClient();

const GROSORES = ["1px", "0.75px", "0.6px", "0.4px"];
const ROTULOS: Record<string, string> = {
  "1px": "1px — ACTUAL",
  "0.75px": "0.75px",
  "0.6px": "0.6px — alineada con los títulos de bloque",
  "0.4px": "0.4px",
};

const OUT = "/tmp/blarq-136-linea-capitulo";
// Alto del recorte, en px CSS: entra el encabezado de columnas, el capítulo 1
// con sus primeras partidas y el arranque del capítulo 2.
const ALTO_RECORTE = 300;

async function main() {
  const host = process.env.DATABASE_URL?.match(/@([^/]+)/)?.[1] ?? "?";
  console.log(`Base: ${host}`);

  const budget = await prisma.budgetVersion.findFirst({
    where: {
      type: "obra",
      version: "V1",
      project: { name: { contains: "Algarrobos" } },
    },
    include: {
      project: true,
      obraChapters: { orderBy: { sortOrder: "asc" } },
      obraItems: { orderBy: { sortOrder: "asc" } },
      paymentTerms: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!budget) throw new Error("No se encontró la obra V1 de Casa Los Algarrobos");
  console.log(`Proyecto: ${budget.project.name} · ${budget.version}`);

  const baseline = await getObraBaselineItems(budget);
  const markers = computeChangeMarkers(budget.obraItems, baseline);

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
      .map((it) => ({
        ...it,
        changeMarker: markers.get(it.lineageId)?.marker ?? null,
      })),
    paymentTerms: budget.paymentTerms.map((t) => ({
      stage: t.stage,
      percentage: t.percentage,
    })),
  });

  const REGLA_CAP = /(\.cap \{[^}]*?border-bottom: )([\d.]+px)( solid #36322C)/;
  if (!REGLA_CAP.test(html)) throw new Error("No se encontró la regla .cap en el CSS");

  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const capturas: { grosor: string; dataUri: string; zoomUri: string }[] = [];

  try {
    for (const grosor of GROSORES) {
      const page = await browser.newPage();
      // 794px = 210mm a 96dpi (ancho A4). deviceScaleFactor 3 para que la
      // diferencia entre 0.4 y 0.6px se vea al mirar la imagen.
      await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 3 });
      await page.setContent(html.replace(REGLA_CAP, `$1${grosor}$3`), {
        waitUntil: "networkidle0",
        timeout: 90_000,
      });
      await page.evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready;
      });

      // Arranque de la tabla: desde el encabezado de columnas hacia abajo.
      const caja = await page.evaluate((alto) => {
        const hd = document.querySelector(".hd");
        if (!hd) return null;
        const r = hd.getBoundingClientRect();
        return {
          x: Math.max(0, r.left - 6),
          y: r.top + window.scrollY - 6,
          width: Math.min(794, r.width + 12),
          height: alto,
        };
      }, ALTO_RECORTE);
      if (!caja) throw new Error("No se encontró el encabezado de columnas (.hd)");

      // Zoom: solo el título del capítulo, su línea y la primera partida — la
      // diferencia entre 0.4 y 0.6px no se ve en el recorte grande.
      const cajaZoom = await page.evaluate(() => {
        const cap = document.querySelector(".cap");
        if (!cap) return null;
        const r = cap.getBoundingClientRect();
        return {
          x: r.left,
          y: r.top + window.scrollY,
          width: Math.min(260, r.width),
          height: r.height + 14,
        };
      });
      if (!cajaZoom) throw new Error("No se encontró el título de capítulo (.cap)");

      const png = (await page.screenshot({
        clip: { ...caja, scale: 3 },
        encoding: "base64",
      })) as unknown as string;
      const pngZoom = (await page.screenshot({
        clip: { ...cajaZoom, scale: 3 },
        encoding: "base64",
      })) as unknown as string;

      const file = path.join(OUT, `captura-${grosor.replace(".", "_")}.png`);
      fs.writeFileSync(file, Buffer.from(png, "base64"));
      fs.writeFileSync(
        path.join(OUT, `zoom-${grosor.replace(".", "_")}.png`),
        Buffer.from(pngZoom, "base64")
      );
      capturas.push({
        grosor,
        dataUri: `data:image/png;base64,${png}`,
        zoomUri: `data:image/png;base64,${pngZoom}`,
      });
      console.log(`${grosor.padStart(7)} → ${file}`);
      await page.close();
    }

    // Lámina comparativa: las cuatro capturas en columna, rotuladas.
    const comparativa = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { margin: 0; padding: 20px; background: #fff; font-family: -apple-system, sans-serif; }
      h1 { font-size: 15px; font-weight: 600; color: #36322C; margin: 0 0 4px; letter-spacing: .02em; }
      .sub { font-size: 11px; color: #9B9182; margin-bottom: 18px; }
      .caso { margin-bottom: 22px; }
      .rot { font-size: 12px; font-weight: 700; color: #36322C; margin-bottom: 6px; letter-spacing: .04em; }
      img { display: block; width: 720px; border: 1px solid #E7E6E4; }
    </style></head><body>
      <h1>Línea bajo el título de capítulo — Casa Los Algarrobos V1</h1>
      <div class="sub">Mismo PDF, mismos datos. Solo cambia el grosor de la línea negra bajo "1 · DEMOLICIONES".</div>
      ${capturas
        .map(
          (c) => `<div class="caso">
        <div class="rot">${ROTULOS[c.grosor] ?? c.grosor}</div>
        <img src="${c.dataUri}" />
      </div>`
        )
        .join("")}
    </body></html>`;

    const page = await browser.newPage();
    await page.setViewport({ width: 780, height: 1000, deviceScaleFactor: 2 });
    await page.setContent(comparativa, { waitUntil: "load" });
    const file = path.join(OUT, "comparativa-grosores.png");
    fs.writeFileSync(file, await page.screenshot({ fullPage: true }));
    console.log(`comparativa → ${file}`);
    await page.close();

    // Lámina de zoom: la misma línea ampliada, para ver la diferencia de grosor.
    const zoom = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { margin: 0; padding: 22px; background: #fff; font-family: -apple-system, sans-serif; }
      h1 { font-size: 15px; font-weight: 600; color: #36322C; margin: 0 0 4px; }
      .sub { font-size: 11px; color: #9B9182; margin-bottom: 20px; }
      .caso { margin-bottom: 20px; }
      .rot { font-size: 12px; font-weight: 700; color: #36322C; margin-bottom: 5px; letter-spacing: .04em; }
      img { display: block; width: 640px; border: 1px solid #E7E6E4; }
    </style></head><body>
      <h1>La misma línea, ampliada</h1>
      <div class="sub">Zoom sobre "1 · DEMOLICIONES" y su línea. Mismo dato, solo cambia el grosor.</div>
      ${capturas
        .map(
          (c) => `<div class="caso">
        <div class="rot">${ROTULOS[c.grosor] ?? c.grosor}</div>
        <img src="${c.zoomUri}" />
      </div>`
        )
        .join("")}
    </body></html>`;

    const pz = await browser.newPage();
    await pz.setViewport({ width: 700, height: 900, deviceScaleFactor: 2 });
    await pz.setContent(zoom, { waitUntil: "load" });
    const fileZoom = path.join(OUT, "comparativa-zoom.png");
    fs.writeFileSync(fileZoom, await pz.screenshot({ fullPage: true }));
    console.log(`zoom → ${fileZoom}`);
    await pz.close();
  } finally {
    await browser.close();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
