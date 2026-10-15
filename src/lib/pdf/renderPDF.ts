import type { Browser, PaperFormat, PDFMargin } from "puppeteer-core";

export interface RenderPDFOptions {
  format?: PaperFormat;
  margin?: PDFMargin;
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  printBackground?: boolean;
  // Scale factor for the PDF render. Defaults to 1.0. Allowed: 0.1 – 2.
  scale?: number;
  // Si es true, los márgenes y tamaño de página los controla el CSS (@page,
  // @page :first) en vez de la opción `margin`. Se usa para que la portada
  // pueda sangrar a borde (margin:0) mientras las páginas de detalle mantienen
  // su margen — imposible con una sola opción `margin` de Puppeteer.
  preferCSSPageSize?: boolean;
  // UNA SOLA HOJA de alto variable, en vez de A4 paginado: el ancho sigue
  // siendo A4 (210mm) y el alto se calcula midiendo el contenido ya renderizado.
  // Sirve para documentos que se leen en pantalla, donde partir en páginas solo
  // molesta (se hace zoom y listo) — pedido de MJ para la orden de compra.
  // Ignora `format` y es incompatible con preferCSSPageSize.
  singlePage?: boolean;
}

// 1 px CSS = 1/96", y 1" = 25,4 mm. Se usa para pasar el alto medido en px del
// navegador al alto en mm que espera Puppeteer.
const MM_POR_PX = 25.4 / 96;
const ANCHO_A4_MM = 210;

function mmDe(valor: string | number | undefined): number {
  if (valor === undefined) return 0;
  if (typeof valor === "number") return valor;
  const n = parseFloat(valor);
  return Number.isFinite(n) ? n : 0;
}

// De dónde sale el ejecutable de Chromium en Vercel, en este orden:
//
//  1. Ya descomprimido en /tmp/chromium (invocación tibia): lo devuelve
//     executablePath() al toque, sin argumentos.
//  2. Los .br que viajan dentro del deployment (node_modules/@sparticuz/
//     chromium/bin, forzados por outputFileTracingIncludes en next.config).
//     Es el camino normal: sin red, ~2-3 s de descompresión.
//  3. Plan B: bajar el release de GitHub (~68 MB, +~10 s). Solo si el bin
//     no viajó (p. ej. si Next volviera a dejar de copiarlo). Se reintenta
//     hasta 3 veces porque el 2026-09-21 GitHub respondió 504 una vez y
//     eso tumbó TODOS los PDFs de la app hasta que MJ volvió a probar.
//
// Los reintentos tienen que caber en el maxDuration=60 s de las rutas: tres
// descargas de ~10 s más la descompresión entran con margen.
const CHROMIUM_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v147.0.0/chromium-v147.0.0-pack.x64.tar";
const INTENTOS_DESCARGA = 3;

type ChromiumPkg = typeof import("@sparticuz/chromium").default;

async function resolverChromium(chromium: ChromiumPkg): Promise<string> {
  try {
    // Sin argumento: usa /tmp/chromium si existe, si no el bin empaquetado.
    return await chromium.executablePath();
  } catch (err) {
    // Solo caemos al plan B si el problema es que el bin no viajó. Cualquier
    // otro error (disco lleno, binario corrupto) se propaga tal cual.
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("does not exist")) throw err;
    console.warn(
      "[renderPDF] El bin de Chromium no viajó en el deployment; bajando de GitHub."
    );
  }

  let ultimoError: unknown;
  for (let intento = 1; intento <= INTENTOS_DESCARGA; intento++) {
    try {
      return await chromium.executablePath(CHROMIUM_URL);
    } catch (err) {
      ultimoError = err;
      console.warn(
        `[renderPDF] Descarga de Chromium falló (intento ${intento}/${INTENTOS_DESCARGA}):`,
        err instanceof Error ? err.message : err
      );
    }
  }
  throw ultimoError;
}

// En Vercel (serverless) el bundle de chromium completo no entra ni
// arranca. Usamos @sparticuz/chromium (binario optimizado para Lambda)
// + puppeteer-core. En local seguimos usando el `puppeteer` con su
// chromium bundleado, así no cambia nada para dev.
async function launchBrowser(): Promise<Browser> {
  const isServerless =
    !!process.env.VERCEL || process.env.NODE_ENV === "production";

  if (isServerless) {
    const [{ default: chromium }, puppeteerCore] = await Promise.all([
      import("@sparticuz/chromium"),
      import("puppeteer-core"),
    ]);
    return puppeteerCore.default.launch({
      args: chromium.args,
      executablePath: await resolverChromium(chromium),
      headless: true,
    }) as unknown as Promise<Browser>;
  }

  const { default: puppeteer } = await import("puppeteer");
  return puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  }) as unknown as Promise<Browser>;
}

/**
 * Render an HTML string to a PDF buffer via headless Chromium.
 * Waits for fonts and images to load before capturing.
 */
export async function renderPDF(
  html: string,
  opts: RenderPDFOptions = {}
): Promise<Uint8Array> {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();

    // En hoja única el viewport tiene que medir EXACTAMENTE lo que va a medir
    // el área imprimible (A4 menos los márgenes laterales); si no, el alto que
    // midamos después corresponde a otro ancho y el corte queda mal.
    const margenIzq = mmDe(opts.margin?.left);
    const margenDer = mmDe(opts.margin?.right);
    if (opts.singlePage) {
      await page.setViewport({
        width: Math.round((ANCHO_A4_MM - margenIzq - margenDer) / MM_POR_PX),
        height: 1200,
      });
    }

    await page.setContent(html, { waitUntil: "networkidle0" });

    // Wait for webfonts and any <img> to finish loading
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
      await Promise.all(
        Array.from(document.images).map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((res) => {
                img.onload = () => res();
                img.onerror = () => res();
              })
        )
      );
    });

    // El alto se mide DESPUÉS de esperar fuentes e imágenes: si se midiera antes,
    // la tipografía de respaldo y las fotos sin cargar dan un alto más chico y la
    // hoja corta el final.
    let altoHojaUnicaMm = 0;
    if (opts.singlePage) {
      const altoPx = await page.evaluate(() =>
        Math.ceil(document.documentElement.scrollHeight)
      );
      altoHojaUnicaMm =
        altoPx * MM_POR_PX + mmDe(opts.margin?.top) + mmDe(opts.margin?.bottom);
    }

    const buffer = await page.pdf({
      ...(opts.singlePage
        ? { width: `${ANCHO_A4_MM}mm`, height: `${altoHojaUnicaMm.toFixed(2)}mm` }
        : { format: opts.format ?? "A4" }),
      printBackground: opts.printBackground ?? true,
      // Con preferCSSPageSize el margen/tamaño lo maneja el CSS @page (permite
      // portada full-bleed + detalle con margen). Si no, se usa la opción margin.
      ...(opts.preferCSSPageSize
        ? { preferCSSPageSize: true }
        : {
            margin: opts.margin ?? {
              top: "14mm",
              bottom: "16mm",
              left: "15mm",
              right: "15mm",
            },
          }),
      displayHeaderFooter: opts.displayHeaderFooter ?? false,
      headerTemplate: opts.headerTemplate ?? "<div></div>",
      footerTemplate: opts.footerTemplate ?? "<div></div>",
      scale: opts.scale,
    });

    return buffer;
  } finally {
    await browser.close();
  }
}
