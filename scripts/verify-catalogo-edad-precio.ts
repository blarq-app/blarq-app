/**
 * Captura del aviso "revisado hace X" en el catálogo de artefactos
 * (arreglo H3 de la auditoría 2026-07-31).
 *
 * Solo LEE: abre el catálogo logueado contra la base de DESARROLLO y saca la
 * foto de las primeras filas. No escribe nada, en ninguna base.
 *
 * Correr con el dev server arriba:
 *   npx tsx scripts/verify-catalogo-edad-precio.ts [url]
 */
import "dotenv/config";
import { readFileSync, mkdirSync } from "fs";
import { chromium } from "playwright";
import hkdf from "@panva/hkdf";

const BASE = process.argv[2] ?? "http://localhost:3157";
const OUT = "docs/auditoria-artefactos-precios-2026-07-assets";
const env = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const SECRET = env.match(/NEXTAUTH_SECRET\s*=\s*"?([^"\n]+)"?/)![1].trim();

async function cookieDeSesion(): Promise<string> {
  const { EncryptJWT } = await import("jose");
  const salt = "authjs.session-token";
  const key = await hkdf("sha256", SECRET, salt, `Auth.js Generated Encryption Key (${salt})`, 64);
  return await new EncryptJWT({ name: "MJ Blanco", email: "mjblanco@blarq.cl", sub: "verificacion" })
    .setProtectedHeader({ alg: "dir", enc: "A256CBC-HS512" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .setJti("verificacion-edad-precio")
    .encrypt(key);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1500, height: 900 },
    deviceScaleFactor: 2,
  });
  await ctx.addCookies([
    {
      name: "authjs.session-token",
      value: await cookieDeSesion(),
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/catalogo/artefactos`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  // Filtramos por un término con productos que SÍ tienen link (los que se
  // pueden revisar): si no, la foto cae en filas cargadas a mano, donde el
  // aviso no se muestra a propósito.
  const filtro = process.argv[3] ?? "wc";
  await page.getByPlaceholder(/Buscar/i).fill(filtro);
  await page.waitForTimeout(1200);

  // Cuántas filas quedaron marcadas como vencidas (ámbar).
  const vencidos = await page.locator("text=/revisado hace (más de un mes|\\d+ meses)/").count();
  const frescos = await page.locator("text=/revisado (hoy|ayer|hace \\d+ días)/").count();
  const sinRevisar = await page.locator("text=sin revisar").count();
  console.log(`En pantalla: ${frescos} al día · ${vencidos} vencidos · ${sinRevisar} sin revisar`);

  // Recortamos a la tabla (el encabezado de la página no aporta acá).
  const tabla = page.locator("main .grid").first();
  await tabla.scrollIntoViewIfNeeded();
  const caja = await page.locator("main").first().boundingBox();
  await page.screenshot({
    path: `${OUT}/catalogo-edad-precio.png`,
    clip: {
      x: caja!.x,
      y: caja!.y + 330,
      width: caja!.width,
      height: Math.min(caja!.height - 330, 420),
    },
  });
  console.log("Captura:", `${OUT}/catalogo-edad-precio.png`);
  await browser.close();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
