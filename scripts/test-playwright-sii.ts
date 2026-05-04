// Probe: validar que Playwright + cert digital + headless Chromium puede:
//   1. Hacer login mTLS al SII
//   2. Llegar al portal MIPE como BLARQ (auto-select empresa)
//   3. Bajar el PDF oficial de un DTE recibido específico
//
// Uso:
//   npx tsx scripts/test-playwright-sii.ts
//
// Target: factura SODIMAC folio 147053281 (CODIGO=2737144106 según research).
// Output: archivo /tmp/sii-test.pdf con el PDF oficial bajado.

import "dotenv/config";
import { chromium } from "playwright";
import * as cheerio from "cheerio";
import { writeFileSync } from "fs";
import { loadCert } from "../src/lib/sii/cert";

const SII_LOGIN =
  "https://herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi?https%3A%2F%2Fmisiir.sii.cl%2Fcgi_misii%2Fsiimenu.cgi";
const FACTURA_SII = "https://www1.sii.cl/factura_sii/factura_sii.htm";
// El listado SIN filtros es el step que setea la sesión como BLARQ (descubierto
// en research del 4-may). Después podemos llamar mipeShowPdf con el CODIGO.
const ADMIN_DOCS_RCP =
  "https://www1.sii.cl/cgi-bin/Portal001/mipeAdminDocsRcp.cgi?RUT_EMI=&FOLIO=&RZN_SOC=&FEC_DESDE=&FEC_HASTA=&TPO_DOC=&ESTADO=&ORDEN=&NUM_PAG=1";

async function main() {
  // Convertimos el .pfx (algoritmos legacy: RC2/SHA1) a PEM cert+key usando
  // node-forge. Playwright los acepta como certPath/keyPath sin pelear con
  // el deprecated provider de OpenSSL 3.
  console.log("→ Cargando cert .pfx y exportando a PEM…");
  const { certificatePem, privateKeyPem, rutHolder } = loadCert();
  console.log(`  cert RUT titular: ${rutHolder}`);
  const certTmpPath = "/tmp/sii-cert.pem";
  const keyTmpPath = "/tmp/sii-key.pem";
  writeFileSync(certTmpPath, certificatePem);
  writeFileSync(keyTmpPath, privateKeyPem);

  console.log("→ Lanzando Chromium headless con cert digital…");
  const browser = await chromium.launch({ headless: true });

  // clientCertificates es la API moderna de Playwright (v1.46+) para mTLS.
  // El origin debe matchear EXACTAMENTE el host del endpoint que pide cert
  // (no el host de los GETs subsiguientes). El SII pide cert solo en
  // herculesr.sii.cl/cgi_AUT2000/.
  // El SII pide cert mTLS en MUCHOS subdominios, no solo en el endpoint de
  // login. Listamos todos los hosts conocidos. Si aparece otro origin que
  // pida cert y no esté listado, lo agregamos.
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
  const context = await browser.newContext({
    clientCertificates: SII_HOSTS.map((origin) => ({
      origin,
      certPath: certTmpPath,
      keyPath: keyTmpPath,
    })),
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  });

  const req = context.request;

  console.log("→ Login mTLS via CAutInicio.cgi (POST referencia)…");
  const loginRes = await req.post(SII_LOGIN, {
    form: { referencia: "https://misiir.sii.cl/cgi_misii/siimenu.cgi" },
    maxRedirects: 15,
  });
  console.log(`  login status=${loginRes.status()}, url=${loginRes.url()}`);

  console.log("→ GET menu Factura Electrónica (extrae csrt)…");
  const menuRes = await req.get(FACTURA_SII, { maxRedirects: 5 });
  const menuBody = (await menuRes.body()).toString("utf8");
  console.log(`  menu status=${menuRes.status()}, len=${menuBody.length}`);
  // _csrf_ viene en window["_csrf_"]="<HEX>" pero los hrefs del menú usan
  // csrt=<digits>. Probamos ambos (preferimos digits si existe).
  const csrtDigits = menuBody.match(/csrt=(\d{15,25})/)?.[1];
  const csrtHex = menuBody.match(/window\["_csrf_"\]\s*=\s*"([a-f0-9]{40,})"/)?.[1];
  console.log(`  csrtDigits=${csrtDigits ?? "—"}, csrtHex=${csrtHex ? csrtHex.slice(0, 20) + "…" : "—"}`);
  const csrt = csrtDigits ?? csrtHex ?? `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

  console.log(`→ GET mipeLaunchPage.cgi (csrt=${csrt.slice(0, 20)})…`);
  const launchRes = await req.get(
    `https://www1.sii.cl/cgi-bin/Portal001/mipeLaunchPage.cgi?OPCION=1&TIPO=4&csrt=${csrt}`,
    { headers: { Referer: FACTURA_SII }, maxRedirects: 5 }
  );
  console.log(`  launch status=${launchRes.status()}, len=${(await launchRes.body()).length}`);

  console.log("→ POST mipeSelEmpresa.cgi (RUT_EMP=77270733&DV_EMP=9)…");
  const selRes = await req.post(
    "https://www1.sii.cl/cgi-bin/Portal001/mipeSelEmpresa.cgi",
    {
      form: { RUT_EMP: "77270733", DV_EMP: "9" },
      headers: { Referer: FACTURA_SII },
      maxRedirects: 5,
    }
  );
  console.log(`  selEmpresa status=${selRes.status()}, len=${(await selRes.body()).length}`);

  console.log("→ GET listado SIN filtros (registra empresa BLARQ)…");
  const listRes = await req.get(ADMIN_DOCS_RCP, {
    headers: { Referer: `https://www1.sii.cl/cgi-bin/Portal001/mipeLaunchPage.cgi?OPCION=1&TIPO=4&csrt=${csrt}` },
    maxRedirects: 5,
  });
  const listBody = (await listRes.body()).toString("utf8");
  console.log(`  listado status=${listRes.status()}, len=${listBody.length}`);
  const hasError = /No ha seleccionado una Empresa/.test(listBody);
  console.log(`  hasError(no empresa)=${hasError}`);
  if (hasError) {
    console.log("❌ El SII rechazó la sesión como BLARQ. Salimos.");
    await browser.close();
    process.exit(1);
  }

  // Buscar SODIMAC 147053281 en el listado SIN filtros (que ya tenemos).
  // Cada fila tiene: rutEmisor + folio + link a mipeGesDocRcp.cgi?CODIGO=N
  // Si no aparece en la página 1, intentamos con filtros (con delay anti-WAF).
  console.log("→ Buscando SODIMAC 147053281 en listado…");
  let codigoMatch = matchSodimacRow(listBody, "96792430", "147053281");
  if (!codigoMatch) {
    console.log("  no aparece en página 1 sin filtros — esperando 3s y probando con filtros…");
    await new Promise((r) => setTimeout(r, 3000));
    const filterRes = await req.get(
      "https://www1.sii.cl/cgi-bin/Portal001/mipeAdminDocsRcp.cgi?RUT_EMI=96792430&FOLIO=147053281&TPO_DOC=33&NUM_PAG=1",
      {
        headers: { Referer: ADMIN_DOCS_RCP },
        maxRedirects: 5,
      }
    );
    const filterBody = (await filterRes.body()).toString("utf8");
    console.log(`  filtrado status=${filterRes.status()}, len=${filterBody.length}`);
    codigoMatch = filterBody.match(/mipeGesDocRcp\.cgi\?CODIGO=(\d+)/)?.[1] ?? null;
    if (!codigoMatch) {
      console.log(`  preview: ${filterBody.slice(0, 600)}`);
      await browser.close();
      process.exit(1);
    }
  }
  const codigo = codigoMatch as string;
  console.log(`✅ CODIGO encontrado: ${codigo}`);

  console.log(`→ Bajando PDF oficial via mipeShowPdf.cgi?CODIGO=${codigo}…`);
  const pdfRes = await req.get(
    `https://www1.sii.cl/cgi-bin/Portal001/mipeShowPdf.cgi?CODIGO=${codigo}`
  );
  console.log(`  pdf status=${pdfRes.status()}, content-type=${pdfRes.headers()["content-type"]}`);
  const pdfBuf = await pdfRes.body();
  console.log(`  pdf bytes=${pdfBuf.length}, magic="${pdfBuf.slice(0, 8).toString()}"`);

  if (!pdfBuf.slice(0, 4).toString().startsWith("%PDF")) {
    console.log("❌ Lo descargado NO es un PDF.");
    console.log(`  preview: ${pdfBuf.slice(0, 400).toString()}`);
    await browser.close();
    process.exit(1);
  }

  writeFileSync("/tmp/sii-test.pdf", pdfBuf);
  console.log(`\n🎯 ÉXITO. PDF guardado en /tmp/sii-test.pdf (${pdfBuf.length} bytes).`);
  console.log("Abrílo con: open /tmp/sii-test.pdf");

  await browser.close();
}

/**
 * Busca en el HTML del listado una fila <tr> que matchee (rutEmisor, folio)
 * y devuelve el CODIGO del link mipeGesDocRcp.cgi de esa fila.
 *
 * Usamos cheerio para iterar las filas como unidades atómicas, evitando el
 * problema de filas vecinas con folios consecutivos (147053280 vs 147053281).
 */
function matchSodimacRow(html: string, rutEmisor: string, folio: string): string | null {
  const $ = cheerio.load(html);
  let result: string | null = null;
  $("tr").each((_, tr) => {
    const tds = $(tr).find("td").map((_, td) => $(td).text().trim()).get();
    // Una fila válida tiene: rut emisor (con DV) + folio en columnas distintas.
    const hasRut = tds.some((t) => t.startsWith(rutEmisor + "-") || t === rutEmisor);
    const hasFolio = tds.some((t) => t === folio);
    if (hasRut && hasFolio) {
      const a = $(tr).find('a[href*="mipeGesDocRcp.cgi"]').first();
      const href = a.attr("href") ?? "";
      const m = href.match(/CODIGO=(\d+)/);
      if (m) {
        result = m[1];
        return false; // break
      }
    }
  });
  return result;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
