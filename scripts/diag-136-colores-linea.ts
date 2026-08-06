/**
 * Pendiente 136 (segunda vuelta) — MJ eligió 0.6px y pidió que además la línea
 * fuera "un poquito menos negra". Este script deja el grosor fijo en 0.6px y
 * varía SOLO el color, para que elija mirando.
 *
 * Los tonos salen de la paleta que ya usa el documento:
 *   #36322C  tinta (el de hoy, el mismo del Cuadro Resumen)
 *   #625A4F  texto de descripciones
 *   #776E60  números de ítem
 *   #8A8175  gris medio
 * (de referencia: los títulos de bloque usan #C2BCB4, mucho más claro; las
 * líneas entre partidas #E7E6E4.)
 *
 * SOLO LECTURA sobre la base viva. Correr con DATABASE_URL a la viva:
 *   npx tsx scripts/diag-136-colores-linea.ts
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";
import { renderObraHTML } from "../src/lib/pdf/ObraPDF.html";
import { renderPDF } from "../src/lib/pdf/renderPDF";
import {
  getObraBaselineItems,
  computeChangeMarkers,
} from "../src/lib/presupuesto/versionDiff";

const prisma = new PrismaClient();

const OUT = "/tmp/blarq-136-linea-capitulo/colores";
const GROSOR = "0.6px";
const COLORES = [
  { hex: "#36322C", rotulo: "#36322C — tinta (el de hoy)" },
  { hex: "#625A4F", rotulo: "#625A4F — un punto más claro" },
  { hex: "#776E60", rotulo: "#776E60 — el gris de los números de ítem" },
  { hex: "#8A8175", rotulo: "#8A8175 — gris medio" },
];

// Recortes dentro del visor de PDF (mismo layout en todas las variantes).
const VISTAS = [
  { nombre: "real", zoom: 100, clip: { x: 453, y: 248, width: 786, height: 118 } },
  { nombre: "zoom", zoom: 300, clip: { x: 458, y: 712, width: 820, height: 112 } },
];

const REGLA_CAP = /(\.cap \{[^}]*?border-bottom: )([\d.]+px solid #[0-9A-Fa-f]{6})/;

async function main() {
  console.log(`Base: ${process.env.DATABASE_URL?.match(/@([^/]+)/)?.[1] ?? "?"}`);

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
  if (!REGLA_CAP.test(html)) throw new Error("No se encontró la regla .cap en el CSS");

  fs.mkdirSync(OUT, { recursive: true });

  for (const c of COLORES) {
    const variante = html.replace(REGLA_CAP, `$1${GROSOR} solid ${c.hex}`);
    const pdf = await renderPDF(variante, {
      format: "A4",
      displayHeaderFooter: false,
      preferCSSPageSize: true,
    });
    fs.writeFileSync(path.join(OUT, `${c.hex.slice(1)}.pdf`), pdf);
    console.log(`${c.hex} → PDF listo`);
  }

  await capturar();
}

async function capturar() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const capturas: { vista: string; hex: string; uri: string }[] = [];

  // Mide el brillo del recorte para saber si el visor ya pintó la hoja.
  const medidor = await browser.newPage();
  await medidor.setContent("<canvas id='c'></canvas>", { waitUntil: "load" });
  const brillo = (uri: string) =>
    medidor.evaluate(async (u: string) => {
      const img = new Image();
      await new Promise((res) => {
        img.onload = res;
        img.src = u;
      });
      const c = document.getElementById("c") as HTMLCanvasElement;
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let suma = 0;
      for (let i = 0; i < d.length; i += 4) suma += (d[i] + d[i + 1] + d[i + 2]) / 3;
      return suma / (d.length / 4);
    }, uri);

  try {
    for (const vista of VISTAS) {
      for (const c of COLORES) {
        const pdf = path.join(OUT, `${c.hex.slice(1)}.pdf`);
        const page = await browser.newPage();
        await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });
        await page.goto(`file://${pdf}#page=2&zoom=${vista.zoom}`, {
          waitUntil: "networkidle0",
          timeout: 60_000,
        });
        let png = "";
        for (let intento = 1; intento <= 12; intento++) {
          await new Promise((r) => setTimeout(r, 2500));
          png = (await page.screenshot({
            clip: { ...vista.clip, scale: 2 },
            encoding: "base64",
          })) as unknown as string;
          if ((await brillo(`data:image/png;base64,${png}`)) > 150) break;
          if (intento % 4 === 0) await page.reload({ waitUntil: "networkidle0" });
          if (intento === 12) throw new Error(`El visor no pintó la página (${c.hex})`);
        }
        capturas.push({ vista: vista.nombre, hex: c.hex, uri: `data:image/png;base64,${png}` });
        console.log(`${vista.nombre.padEnd(4)} ${c.hex} capturado`);
        await page.close();
      }
    }

    for (const vista of VISTAS) {
      const titulo =
        vista.nombre === "real"
          ? "Color de la línea — tamaño real del PDF"
          : "Color de la línea — ampliada 3 veces";
      const lamina = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body { margin: 0; padding: 22px; background: #fff; font-family: -apple-system, sans-serif; }
        h1 { font-size: 15px; font-weight: 600; color: #36322C; margin: 0 0 4px; }
        .sub { font-size: 11px; color: #9B9182; margin-bottom: 20px; }
        .caso { margin-bottom: 18px; }
        .rot { font-size: 12px; font-weight: 700; color: #36322C; margin-bottom: 5px; letter-spacing: .04em; }
        img { display: block; width: 660px; border: 1px solid #E7E6E4; }
      </style></head><body>
        <h1>${titulo} — Casa Los Algarrobos V1</h1>
        <div class="sub">Los cuatro son el PDF real con la línea en 0.6px. Solo cambia el color.</div>
        ${capturas
          .filter((c) => c.vista === vista.nombre)
          .map((c) => {
            const rot = COLORES.find((x) => x.hex === c.hex)!.rotulo;
            return `<div class="caso"><div class="rot">${rot}</div><img src="${c.uri}" /></div>`;
          })
          .join("")}
      </body></html>`;

      const p = await browser.newPage();
      await p.setViewport({ width: 720, height: 900, deviceScaleFactor: 2 });
      await p.setContent(lamina, { waitUntil: "load" });
      const file = path.join(OUT, `comparativa-color-${vista.nombre}.png`);
      fs.writeFileSync(file, await p.screenshot({ fullPage: true }));
      console.log(`lámina → ${file}`);
      await p.close();
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
  .finally(async () => {
    await prisma.$disconnect();
  });
