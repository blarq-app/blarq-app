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
    // El binario local /node_modules/@sparticuz/chromium/bin no se está
    // copiando al bundle de Vercel pese a outputFileTracingIncludes.
    // Workaround: pasar la URL del release de GitHub a executablePath()
    // — descarga el .tar.br comprimido a /tmp/chromium en cold start
    // (+~10s la primera vez) y lo reusa entre invocaciones tibias.
    const CHROMIUM_URL =
      "https://github.com/Sparticuz/chromium/releases/download/v147.0.0/chromium-v147.0.0-pack.x64.tar";
    return puppeteerCore.default.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(CHROMIUM_URL),
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

    const buffer = await page.pdf({
      format: opts.format ?? "A4",
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
