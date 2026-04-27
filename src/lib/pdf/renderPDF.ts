import puppeteer, { type PaperFormat, type PDFMargin } from "puppeteer";

export interface RenderPDFOptions {
  format?: PaperFormat;
  margin?: PDFMargin;
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  printBackground?: boolean;
}

/**
 * Render an HTML string to a PDF buffer via headless Chromium.
 * Waits for fonts and images to load before capturing.
 */
export async function renderPDF(
  html: string,
  opts: RenderPDFOptions = {}
): Promise<Uint8Array> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

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
      margin: opts.margin ?? {
        top: "14mm",
        bottom: "16mm",
        left: "15mm",
        right: "15mm",
      },
      displayHeaderFooter: opts.displayHeaderFooter ?? false,
      headerTemplate: opts.headerTemplate ?? "<div></div>",
      footerTemplate: opts.footerTemplate ?? "<div></div>",
    });

    return buffer;
  } finally {
    await browser.close();
  }
}
