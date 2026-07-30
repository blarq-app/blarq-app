/**
 * Capturas de las dos pantallas del detalle de traspasos a Sueldos:
 *
 *   1. Proyecto → "Me paso a Sueldos": el detalle cerrado (como estaba antes)
 *      y abierto, con las transferencias por fecha.
 *   2. Banco → Movimientos: el filtro por obra en la columna Respaldo, sin
 *      filtrar y filtrado por la obra.
 *
 * Solo mira, no escribe nada en la base. La app está detrás del login y en dev
 * no se puede tipear la clave a mano, así que se firma una cookie de sesión con
 * el NEXTAUTH_SECRET del .env — mismo truco que scripts/verify-logo-sidebar.ts.
 *
 * Correr con:  npx tsx scripts/verify-traspasos-detalle.ts [http://localhost:3011]
 */
import "dotenv/config";
import { readFileSync, mkdirSync } from "fs";
import { chromium, type Page } from "playwright";
import hkdf from "@panva/hkdf";

const BASE = process.argv[2] ?? "http://localhost:3011";
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
    .setJti("verificacion-traspasos")
    .encrypt(key);
}

// Recorta la captura al bloque que interesa (no a la pantalla entera): así se
// lee el detalle sin tener que buscarlo en una página de 4000px.
async function capturarBloque(page: Page, selector: string, nombre: string) {
  mkdirSync(OUT, { recursive: true });
  const ruta = `${OUT}/${nombre}.png`;
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await el.screenshot({ path: ruta });
  console.log("  capturado:", ruta);
}

async function main() {
  const browser = await chromium.launch();
  const token = await cookieDeSesion();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([
    {
      name: "authjs.session-token",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await ctx.newPage();

  // ── 1. Proyecto: "Me paso a Sueldos" ────────────────────────────────────
  const projectId = process.env.VERIFY_PROJECT_ID ?? "cmoj9qhwe0000rtpz4wdb64cn";
  await page.goto(`${BASE}/proyectos/${projectId}/resumen`, { waitUntil: "networkidle" });

  // El bloque es la tarjeta que contiene el título "Me paso a Sueldos".
  const bloque = 'div:has(> div > h2:text-is("Me paso a Sueldos"))';
  await page.waitForSelector(bloque);

  // ANTES: el detalle cerrado — es exactamente lo que se veía hasta ahora,
  // solo el total "Ya transferido", más el botón nuevo.
  await capturarBloque(page, bloque, "traspasos-1-antes-cerrado");

  // DESPUÉS: abierto, con la lista de transferencias por fecha.
  await page.getByRole("button", { name: /Ver \d+ transferencia/ }).click();
  await page.waitForSelector('text=Total transferido');
  await capturarBloque(page, bloque, "traspasos-2-detalle-abierto");

  // ── 2. Banco → Movimientos: filtro por obra ─────────────────────────────
  // ANTES: la cuenta Sueldos sin filtrar por obra (todos los traspasos).
  await page.goto(`${BASE}/banco/movimientos?respaldo=interna`, { waitUntil: "networkidle" });
  await page.waitForSelector("table");
  const filasAntes = await page.locator("tbody tr").count();
  await capturarBloque(page, "main", "traspasos-3-banco-sin-filtro");

  // DESPUÉS: filtrado por la obra desde el desplegable de la columna Respaldo.
  await page.goto(`${BASE}/banco/movimientos?respaldo=interna&proyecto=${projectId}`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector("table");
  const filasDespues = await page.locator("tbody tr").count();
  await capturarBloque(page, "main", "traspasos-4-banco-filtrado-obra");

  console.log(`\n  Banco: ${filasAntes} traspasos sin filtro → ${filasDespues} filtrados por la obra`);
  if (filasDespues >= filasAntes) {
    console.log("  OJO: el filtro no redujo la lista. Revisar.");
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
