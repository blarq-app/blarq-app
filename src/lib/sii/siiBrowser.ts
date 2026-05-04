// Cliente del portal MIPE del SII para bajar PDFs oficiales de DTEs recibidos.
//
// Usa Playwright + cert digital (mTLS) para hacer login y operar como BLARQ.
// Diseñado para correr en LOCAL (laptop de MJ con cert en .env), no en
// Vercel — el portal del SII tiene WAF (F5 BIG-IP) que detecta clientes
// no-browser y rechaza con 503. El Chromium real de Playwright pasa el WAF.
//
// Uso típico (desde scripts/sync-sii-pdfs.ts):
//
//   const ctx = await openSiiSession();
//   const codigos = await loadAllSiiCodigos(ctx); // Map<key, codigo>
//   for (const inv of invoicesSinPdf) {
//     const key = `${inv.rutIssuer}|${inv.folioNumber}|${inv.tipoDoc}`;
//     const codigo = codigos.get(key);
//     if (!codigo) continue; // DTE no aparece en listado SII (NC enviadas
//                            // por intercambio directo, etc — fallback al
//                            // PDF interno desde la app)
//     const pdf = await downloadSiiPdf(ctx, codigo);
//     await prisma.invoice.update({ where:{id:inv.id}, data:{siiCodigo:codigo, pdfContent:pdf, pdfFetchedAt:new Date()}});
//   }
//   await closeSiiSession(ctx);

import { chromium, type Browser, type BrowserContext, type APIRequestContext } from "playwright";
import * as cheerio from "cheerio";
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadCert } from "./cert";

// ─── Constantes del portal SII ─────────────────────────────────────────────

const SII_LOGIN_URL =
  "https://herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi?https%3A%2F%2Fmisiir.sii.cl%2Fcgi_misii%2Fsiimenu.cgi";
const SII_LOGIN_RETORNO = "https://misiir.sii.cl/cgi_misii/siimenu.cgi";
const FACTURA_SII_MENU = "https://www1.sii.cl/factura_sii/factura_sii.htm";
const MIPE_LAUNCH = "https://www1.sii.cl/cgi-bin/Portal001/mipeLaunchPage.cgi";
const MIPE_SEL_EMPRESA = "https://www1.sii.cl/cgi-bin/Portal001/mipeSelEmpresa.cgi";
const MIPE_ADMIN_DOCS_RCP_BASE = "https://www1.sii.cl/cgi-bin/Portal001/mipeAdminDocsRcp.cgi";
const MIPE_SHOW_PDF = "https://www1.sii.cl/cgi-bin/Portal001/mipeShowPdf.cgi";

// Hosts SII que usan mTLS — listamos todos los conocidos para que Playwright
// presente el cert cliente independientemente del subdominio destino.
const SII_HOSTS = [
  "https://herculesr.sii.cl",
  "https://www1.sii.cl",
  "https://www4.sii.cl",
  "https://misiir.sii.cl",
  "https://palena.sii.cl",
  "https://maullin.sii.cl",
  "https://zeusr.sii.cl",
  "https://zeus.sii.cl",
];

// User-Agent moderno; el SII rechaza clientes con UA obvios de bot.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

// ─── Sesión SII ────────────────────────────────────────────────────────────

export interface SiiSession {
  browser: Browser;
  context: BrowserContext;
  request: APIRequestContext;
}

/**
 * Abre una sesión nueva contra el SII: lanza Chromium, hace login con cert
 * digital, navega por el flow del menú MIPE, y registra a BLARQ como empresa
 * activa. La sesión queda lista para llamar `loadAllSiiCodigos` y/o
 * `downloadSiiPdf`.
 *
 * Requiere SII_CERT_PATH y SII_CERT_PASSWORD en process.env.
 */
export async function openSiiSession(opts: { headless?: boolean } = {}): Promise<SiiSession> {
  // El cert .pfx chileno usa algoritmos legacy (RC2/SHA1) que OpenSSL 3
  // deprecó. Convertimos a PEM via node-forge (que sí los soporta) y le
  // pasamos los PEM a Playwright, que los acepta sin problemas.
  const { certificatePem, privateKeyPem } = loadCert();
  const certTmpPath = join(tmpdir(), `sii-cert-${process.pid}.pem`);
  const keyTmpPath = join(tmpdir(), `sii-key-${process.pid}.pem`);
  writeFileSync(certTmpPath, certificatePem);
  writeFileSync(keyTmpPath, privateKeyPem);

  const browser = await chromium.launch({ headless: opts.headless ?? true });
  const context = await browser.newContext({
    clientCertificates: SII_HOSTS.map((origin) => ({
      origin,
      certPath: certTmpPath,
      keyPath: keyTmpPath,
    })),
    userAgent: USER_AGENT,
  });

  const req = context.request;

  // 1. Login mTLS — POST con body referencia=<URL_RETORNO> es el formato
  //    que el SII acepta (validado empíricamente). Sin body o con body
  //    vacío, devuelve error 01.01.215.500.760.52.
  const loginRes = await req.post(SII_LOGIN_URL, {
    form: { referencia: SII_LOGIN_RETORNO },
    maxRedirects: 15,
  });
  if (loginRes.status() !== 200) {
    await browser.close();
    throw new Error(`SII login falló: status ${loginRes.status()}`);
  }

  // 2. Warmup: visitar el menú de Factura Electrónica (estático). En el flow
  //    del browser esto carga JS que registra la sesión. Con context.request
  //    el efecto principal es acumular cookies del subdominio www1.
  await req.get(FACTURA_SII_MENU, { maxRedirects: 5 });

  // 3. Disparar mipeLaunchPage (OPCION=1=ver, TIPO=4=docs recibidos). El csrt
  //    usado es un timestamp+random — el server no parece validarlo
  //    estrictamente; solo necesita que esté presente.
  const csrt = `${Date.now()}${Math.floor(Math.random() * 1e6).toString().padStart(6, "0")}`;
  await req.get(`${MIPE_LAUNCH}?OPCION=1&TIPO=4&csrt=${csrt}`, {
    headers: { Referer: FACTURA_SII_MENU },
    maxRedirects: 5,
  });

  // 4. POST a mipeSelEmpresa.cgi con RUT_EMP/DV_EMP de BLARQ. ESTE es el step
  //    crítico — sin él, el listado responde "No ha seleccionado una Empresa".
  //    Funciona porque MJ es representante de UNA sola empresa (BLARQ).
  const blarqRut = process.env.SII_BLARQ_RUT ?? "77270733";
  const blarqDv = process.env.SII_BLARQ_DV ?? "9";
  const selRes = await req.post(MIPE_SEL_EMPRESA, {
    form: { RUT_EMP: blarqRut, DV_EMP: blarqDv },
    headers: { Referer: FACTURA_SII_MENU },
    maxRedirects: 5,
  });
  if (selRes.status() !== 200) {
    await browser.close();
    throw new Error(`mipeSelEmpresa falló: status ${selRes.status()}`);
  }

  return { browser, context, request: req };
}

/** Cierra la sesión y libera recursos del browser. */
export async function closeSiiSession(s: SiiSession): Promise<void> {
  await s.context.close();
  await s.browser.close();
}

// ─── Listado de DTEs recibidos (paginado) ──────────────────────────────────

/**
 * Carga todas las páginas del listado de DTEs recibidos del SII y construye
 * un mapa indexado por (rutEmisor, folio, tipoDoc) → CODIGO.
 *
 * `tipoDoc` aquí es el integer del DTE (33, 34, 39, 41, 56, 61). El listado
 * SII usa el nombre humano ("Factura Electronica", "Nota de Credito Electronica",
 * etc); convertimos al integer interno para matchear con Invoice.tipoDoc.
 *
 * Baja en serie con 1.5s entre páginas para no gatillar el WAF (probamos
 * que <1s da 503 ocasional).
 *
 * Default: bajar las primeras 5 páginas (=500 facturas, suficiente para BLARQ).
 * `maxPages` ajustable si hace falta.
 */
export async function loadAllSiiCodigos(
  s: SiiSession,
  opts: { maxPages?: number; pageDelayMs?: number } = {}
): Promise<Map<string, { codigo: string; rutEmisor: string; folio: string; tipoDoc: number }>> {
  const maxPages = opts.maxPages ?? 5;
  const delayMs = opts.pageDelayMs ?? 1500;

  const result = new Map<string, { codigo: string; rutEmisor: string; folio: string; tipoDoc: number }>();

  for (let pag = 1; pag <= maxPages; pag++) {
    if (pag > 1) await new Promise((r) => setTimeout(r, delayMs));

    const url = `${MIPE_ADMIN_DOCS_RCP_BASE}?RUT_EMI=&FOLIO=&RZN_SOC=&FEC_DESDE=&FEC_HASTA=&TPO_DOC=&ESTADO=&ORDEN=&NUM_PAG=${pag}`;
    const res = await s.request.get(url, { maxRedirects: 5 });
    if (res.status() !== 200) {
      console.warn(`[siiBrowser] página ${pag} status ${res.status()}, parando paginación`);
      break;
    }
    const html = (await res.body()).toString("utf8");

    const rowsAdded = parseListadoRows(html, result);
    if (rowsAdded === 0) {
      // Página vacía → no hay más DTEs.
      break;
    }
  }

  return result;
}

/**
 * Parsea filas del listado MIPE y agrega entradas al map. Devuelve cuántas
 * filas válidas se encontraron en esta página.
 */
function parseListadoRows(
  html: string,
  out: Map<string, { codigo: string; rutEmisor: string; folio: string; tipoDoc: number }>
): number {
  const $ = cheerio.load(html);
  let added = 0;
  $("tr").each((_, tr) => {
    const tds = $(tr).find("td").map((_, td) => $(td).text().trim()).get();
    if (tds.length < 5) return;
    // Heurística: encontrar el RUT (formato XXXXXXXX-K), el folio (puro
    // entero), el tipo de documento (texto humano), y el link al detalle.
    const rutCol = tds.find((t) => /^\d{7,9}-[\dkK]$/.test(t));
    if (!rutCol) return;
    const rutEmisor = rutCol.split("-")[0];
    // Folio: el primer entero "puro" después del rut (varios columns como
    // monto y números también son enteros — heurística: primer 4-12 dígitos
    // sin separadores que no sea el rut).
    const folioCol = tds.find((t) => /^\d{1,12}$/.test(t) && t !== rutEmisor);
    if (!folioCol) return;
    // Tipo: nombre humano del documento.
    const tipoNombre = tds.find((t) => /factura|nota|guia|liquidaci/i.test(t));
    const tipoDoc = parseTipoDoc(tipoNombre ?? "");
    if (!tipoDoc) return;

    const a = $(tr).find('a[href*="mipeGesDocRcp.cgi"]').first();
    const href = a.attr("href") ?? "";
    const m = href.match(/CODIGO=(\d+)/);
    if (!m) return;

    const codigo = m[1];
    const key = `${rutEmisor}|${folioCol}|${tipoDoc}`;
    if (!out.has(key)) {
      out.set(key, { codigo, rutEmisor, folio: folioCol, tipoDoc });
      added++;
    }
  });
  return added;
}

/** Mapea el nombre humano del listado SII al integer tipoDoc del DTE. */
function parseTipoDoc(nombre: string): number | null {
  const n = nombre.toLowerCase();
  if (n.includes("factura") && n.includes("exenta")) return 34;
  if (n.includes("factura") && (n.includes("compra") || n.includes("electronica"))) return n.includes("compra") ? 46 : 33;
  if (n.includes("nota") && n.includes("credito")) return 61;
  if (n.includes("nota") && n.includes("debito")) return 56;
  if (n.includes("guia")) return 52;
  if (n.includes("liquidaci")) return 43;
  if (n.includes("boleta") && n.includes("exenta")) return 41;
  if (n.includes("boleta")) return 39;
  return null;
}

// ─── Descargar PDF oficial ─────────────────────────────────────────────────

/**
 * Baja el PDF oficial del DTE identificado por `codigo` (CODIGO interno SII).
 * Devuelve el Buffer PDF (tipicamente 100-200KB, %PDF-1.4).
 */
export async function downloadSiiPdf(s: SiiSession, codigo: string): Promise<Buffer> {
  const res = await s.request.get(`${MIPE_SHOW_PDF}?CODIGO=${codigo}`);
  if (res.status() !== 200) {
    throw new Error(`mipeShowPdf CODIGO=${codigo} falló: status ${res.status()}`);
  }
  const ct = res.headers()["content-type"] ?? "";
  if (!ct.includes("pdf")) {
    throw new Error(`mipeShowPdf CODIGO=${codigo} devolvió ${ct}, esperaba application/pdf`);
  }
  const buf = await res.body();
  if (!buf.subarray(0, 4).toString().startsWith("%PDF")) {
    throw new Error(`mipeShowPdf CODIGO=${codigo} devolvió bytes que no son PDF`);
  }
  return buf;
}
