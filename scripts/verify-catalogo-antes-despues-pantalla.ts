/**
 * Captura la MISMA zona del catálogo de artefactos para comparar la pantalla
 * antes y después del arreglo de precios (2026-07-31/08-01).
 *
 * Se corre dos veces, con el código de cada versión:
 *   git checkout <commit-viejo> && npx tsx scripts/... antes
 *   git checkout <rama>         && npx tsx scripts/... despues
 *
 * Solo LEE, contra la base de DESARROLLO.
 *
 *   npx tsx scripts/verify-catalogo-antes-despues-pantalla.ts <antes|despues> [filtro] [url]
 */
import "dotenv/config";
import { readFileSync, mkdirSync } from "fs";
import { chromium } from "playwright";
import hkdf from "@panva/hkdf";

const MOMENTO = process.argv[2] === "antes" ? "antes" : "despues";
const FILTRO = process.argv[3] ?? "lavamanos";
const BASE = process.argv[4] ?? "http://localhost:3157";
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
    .setJti("verificacion-pantalla")
    .encrypt(key);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1500, height: 950 },
    deviceScaleFactor: 2,
  });
  await ctx.addCookies([{
    name: "authjs.session-token", value: await cookieDeSesion(),
    domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax",
  }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/catalogo/artefactos`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(2000);
  await page.getByPlaceholder(/Buscar/i).fill(FILTRO);
  await page.waitForTimeout(1800);

  const caja = await page.locator("main").first().boundingBox();
  const ruta = `${OUT}/pantalla-catalogo-${MOMENTO}.png`;
  await page.screenshot({
    path: ruta,
    // Desde el encabezado de la tabla hacia abajo: ahí están las columnas.
    clip: { x: caja!.x, y: caja!.y + 210, width: caja!.width, height: 480 },
  });
  console.log("capturado:", ruta);
  await browser.close();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
