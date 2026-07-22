// Genera el PDF mensual de gastos a un archivo, usando EXACTAMENTE el mismo
// código que el endpoint (listarGastosDelMes + renderGastosMesHtml +
// renderPDF). Sirve para mirar el resultado sin levantar el server.
//
// Uso:  npx tsx scripts/preview-pdf-gastos.ts .env 2026-06 salida.pdf
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { listarGastosDelMes } from "../src/lib/contabilidad/gastosMes";
import { renderGastosMesHtml } from "../src/lib/pdf/GastosMesPDF.html";
import { renderPDF } from "../src/lib/pdf/renderPDF";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const [envPath = ".env", mes = "2026-06", salida = "gastos.pdf"] =
  process.argv.slice(2);

const url = readFileSync(envPath, "utf8")
  .split("\n")
  .map((l) => l.match(/^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?\s*$/))
  .find(Boolean)![1];
console.log("HOST:", url.match(/@([^/]+)\//)?.[1]);
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  const [y, m] = mes.split("-").map(Number);
  const items = await listarGastosDelMes(prisma, y, m - 1);
  const total = items.reduce((s, g) => s + g.monto, 0);
  console.log(
    `${items.length} gastos en ${MESES[m - 1]} ${y} · total $${total.toLocaleString("es-CL")} · con foto: ${items.filter((i) => i.foto).length}`
  );
  for (const i of items) {
    console.log(
      `  ${i.orden}. ${i.fecha.toISOString().slice(0, 10)} ${i.tipo.padEnd(14)} ${(i.comercio ?? "-").padEnd(28)} pagó=${i.quienPago.padEnd(22)} $${i.monto.toLocaleString("es-CL")}`
    );
  }

  const html = renderGastosMesHtml({
    mesNombre: MESES[m - 1],
    year: y,
    items,
    emitidoEl: new Date(),
    incluirFotos: true,
  });
  const pdf = await renderPDF(html, { format: "A4" });
  writeFileSync(salida, pdf);
  console.log(`\nPDF: ${salida} (${Math.round(pdf.byteLength / 1024)} KB)`);

  // Además del PDF, un PNG por página para poder mirarlas acá (el visor de PDF
  // no anda en headless).
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 794, height: 1123 }); // A4 en px a 96dpi
  await page.setContent(html, { waitUntil: "networkidle0" });
  const paginas = await page.$$(".page");
  for (const [i, el] of paginas.entries()) {
    await el.screenshot({ path: salida.replace(/\.pdf$/, `_pag${i + 1}.png`) });
  }
  await browser.close();
  console.log(`PNGs: ${paginas.length} páginas`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
