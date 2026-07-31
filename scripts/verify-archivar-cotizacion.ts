/**
 * Capturas del botón "Archivar" en la lista de cotizaciones.
 *
 *   modo "antes"   → solo saca la foto de la fila como estaba (nada más que la
 *                    crucecita de eliminar). Se corre con el cambio stasheado.
 *   modo "despues" → foto de la fila con el botón nuevo, archiva la primera
 *                    cotización activa, fotografía la pestaña Archivadas, la
 *                    desarchiva y fotografía la vuelta a Activas.
 *
 * Escribe status en la base de DESARROLLO (ep-solitary-mud), nunca en la viva.
 * La app está detrás del login y en dev no se puede tipear la clave a mano, así
 * que se firma una cookie de sesión con el NEXTAUTH_SECRET del .env — mismo
 * truco que scripts/verify-traspasos-detalle.ts.
 *
 * Correr con:  npx tsx scripts/verify-archivar-cotizacion.ts despues [url]
 */
import "dotenv/config";
import { readFileSync, mkdirSync } from "fs";
import { chromium, type Page } from "playwright";
import hkdf from "@panva/hkdf";

const MODO = process.argv[2] === "antes" ? "antes" : "despues";
const BASE = process.argv[3] ?? "http://localhost:3141";
const OUT = "scripts/_capturas";

const env = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const SECRET = env.match(/NEXTAUTH_SECRET\s*=\s*"?([^"\n]+)"?/)![1].trim();

async function cookieDeSesion(): Promise<string> {
  const { EncryptJWT } = await import("jose");
  const salt = "authjs.session-token";
  const key = await hkdf(
    "sha256",
    SECRET,
    salt,
    `Auth.js Generated Encryption Key (${salt})`,
    64
  );
  return await new EncryptJWT({
    name: "MJ Blanco",
    email: "mjblanco@blarq.cl",
    sub: "verificacion",
  })
    .setProtectedHeader({ alg: "dir", enc: "A256CBC-HS512" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .setJti("verificacion-archivar")
    .encrypt(key);
}

// Recorta a la franja de arriba (título + pestañas + tabla): el resto de la
// página es blanco y solo hace la foto más difícil de mirar.
async function capturar(page: Page, nombre: string) {
  mkdirSync(OUT, { recursive: true });
  const ruta = `${OUT}/${nombre}.png`;
  const caja = await page.locator("main").first().boundingBox();
  await page.screenshot({
    path: ruta,
    clip: {
      x: caja!.x,
      y: caja!.y,
      width: caja!.width,
      height: Math.min(caja!.height, 520),
    },
  });
  console.log("  capturado:", ruta);
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1180, height: 620 },
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

  await page.goto(`${BASE}/cotizaciones?tab=activas`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  if (MODO === "antes") {
    await capturar(page, "archivar-1-antes-activas");
    await browser.close();
    return;
  }

  await capturar(page, "archivar-2-despues-activas");

  // Archivar la cotización de demo y ver que aparece en Archivadas.
  const DEMO = "Depto Vitacura";
  console.log("  archivando:", DEMO);
  await page
    .getByRole("button", { name: new RegExp(`^Archivar «${DEMO}`) })
    .first()
    .click();
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/cotizaciones?tab=archivadas`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await capturar(page, "archivar-3-archivadas");

  // Desarchivar desde ahí y ver que vuelve a Activas.
  await page.getByRole("button", { name: /^Desarchivar/ }).first().click();
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/cotizaciones?tab=activas`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await capturar(page, "archivar-4-desarchivada-vuelve");

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
