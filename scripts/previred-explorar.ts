// Corrida de OBSERVACIÓN de Previred (no es el robot final).
//
// Abre un Chromium controlado por Playwright y se queda mirando mientras MJ
// navega a mano: login -> Pago Cotizaciones -> intentar subir el archivo ->
// sección FUNes. Graba a disco una captura (PNG) + el HTML de CADA pantalla,
// INCLUIDAS las ventanas emergentes (popups) que la extensión de Chrome no ve.
//
// Con eso aprendemos los clics/campos exactos para escribir el robot real.
// NO hace clics solo, NO paga nada. Corre LOCAL en la Mac de MJ.
//
//   npx tsx scripts/previred-explorar.ts
//
// La clave la pone MJ a mano en la ventana que se abre (el script nunca la ve).

import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const OUTDIR =
  "/private/tmp/claude-501/-Users-mjblanco-Desktop-blarq-app/7b8dcedc-2b0e-411c-afaa-9ee7edabe7bb/scratchpad/previred-captura";
const LOGIN_URL = "https://www.previred.com/wPortal/login/login.jsp";
const DURACION_MIN = 20; // se queda abierto este rato (o hasta cerrar la ventana)

mkdirSync(OUTDIR, { recursive: true });

let seq = 0;
const vistos = new Map<Page, string>(); // última firma capturada por página

function ts(): string {
  // Hora local sin depender de Date.now() prohibido en otros contextos: acá sí
  // estamos en un script normal, se puede usar new Date().
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function capturar(page: Page, etiqueta: string) {
  if (page.isClosed()) return;
  let url = "";
  try {
    url = page.url();
  } catch {
    return;
  }
  if (!url || url === "about:blank") return;

  // Firma para no duplicar: url + cantidad de inputs file + título
  let titulo = "";
  let fileInputs: string[] = [];
  let texto = "";
  try {
    titulo = await page.title();
    fileInputs = await page.$$eval('input[type="file"]', (els) =>
      els.map((e) => (e as HTMLElement).outerHTML)
    );
    texto = (await page.evaluate(() => document.body?.innerText ?? "")).slice(0, 600);
  } catch {
    // página en transición
  }
  const firma = `${url}|${titulo}|${fileInputs.length}|${texto.length}`;
  if (vistos.get(page) === firma) return; // sin cambios relevantes
  vistos.set(page, firma);

  seq += 1;
  const base = `${String(seq).padStart(3, "0")}_${ts()}`;
  try {
    await page.screenshot({ path: join(OUTDIR, `${base}.png`), fullPage: false });
  } catch {}
  const html = await page.content().catch(() => "");
  writeFileSync(join(OUTDIR, `${base}.html`), html);
  writeFileSync(
    join(OUTDIR, `${base}.info.txt`),
    [
      `URL:    ${url}`,
      `TITULO: ${titulo}`,
      `EVENTO: ${etiqueta}`,
      `INPUTS FILE (${fileInputs.length}):`,
      ...fileInputs.map((h) => `   ${h}`),
      ``,
      `TEXTO VISIBLE (primeros 600):`,
      texto,
    ].join("\n")
  );
  console.log(`[captura ${seq}] ${etiqueta} -> ${url} (${fileInputs.length} input file)`);
}

function engancharPagina(page: Page, comoLlego: string) {
  capturar(page, comoLlego);
  page.on("load", () => capturar(page, "load"));
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) capturar(page, "navegó");
  });
  page.on("popup", (p) => engancharPagina(p, "popup-hijo"));
}

async function main() {
  console.log("Abriendo Chromium (ventana visible). La clave la ponés vos.");
  console.log(`Capturas en: ${OUTDIR}`);
  const browser = await chromium.launch({ headless: false, args: ["--start-maximized"] });
  const context = await browser.newContext({ viewport: null });

  // Cualquier página/popup nuevo que aparezca en el contexto queda enganchado.
  context.on("page", (p) => engancharPagina(p, "nueva-pestaña/ventana"));

  const page = await context.newPage();
  engancharPagina(page, "inicial");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

  // Loop de respaldo: cada 3s captura todas las páginas abiertas (atrapa cambios
  // de SPA que no disparan navegación).
  const fin = Date.now() + DURACION_MIN * 60_000;
  const timer = setInterval(() => {
    for (const p of context.pages()) capturar(p, "tick");
  }, 3000);

  // Termina cuando se cierra el browser o se acaba el tiempo.
  browser.on("disconnected", () => {
    clearInterval(timer);
    console.log("Ventana cerrada. Fin de la observación.");
    process.exit(0);
  });
  while (Date.now() < fin) {
    await new Promise((r) => setTimeout(r, 2000));
    if (!browser.isConnected()) break;
  }
  clearInterval(timer);
  await browser.close().catch(() => {});
  console.log("Tiempo cumplido. Fin de la observación.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
