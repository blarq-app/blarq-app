/**
 * Capturas del PDF del maestro para que MJ compare las DOS formas del
 * subtotal por capítulo, sin abrir el PDF. Renderiza el HTML del documento a
 * ancho A4 real y recorta desde el encabezado hasta unos capítulos abajo.
 *
 * Uso: npx tsx scripts/diag-173-capturas.ts <archivo.html> <salida.png> [alto]
 */
import puppeteer from "puppeteer";

const ANCHO_A4_PX = Math.round((210 - 24) / (25.4 / 96)); // A4 menos márgenes

async function main() {
  const [htmlFile, out, altoArg, desdeArg] = process.argv.slice(2);
  if (!htmlFile || !out) throw new Error("Uso: <archivo.html> <salida.png>");

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  // deviceScaleFactor 3: el documento es de 5,6pt, a escala 1 no se lee nada.
  await page.setViewport({
    width: ANCHO_A4_PX,
    height: 1400,
    deviceScaleFactor: 3,
  });
  await page.goto(`file://${htmlFile}`, { waitUntil: "networkidle0" });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });

  await page.screenshot({
    path: out,
    clip: {
      x: 0,
      y: Number(desdeArg ?? 0),
      width: ANCHO_A4_PX,
      height: Number(altoArg ?? 620),
    },
  });
  await browser.close();
  console.log(`  ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
