/**
 * Captura el logo nuevo donde se ve: la barra lateral (escritorio y celular) y
 * la pantalla de login. Solo mira, no escribe nada en la base.
 *
 * La barra lateral está detrás del login, y en dev no se puede tipear la clave a
 * mano, así que se firma una cookie de sesión con el NEXTAUTH_SECRET del .env —
 * mismo truco que usa scripts/verify-estado-movimientos.ts.
 *
 * Correr con:  npx tsx scripts/verify-logo-sidebar.ts [http://localhost:3000]
 */
import "dotenv/config";
import { readFileSync, mkdirSync } from "fs";
import { chromium, type Page } from "playwright";
import hkdf from "@panva/hkdf";

const BASE = process.argv[2] ?? "http://localhost:3000";
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
    .setJti("verificacion-logo")
    .encrypt(key);
}

async function capturar(page: Page, nombre: string) {
  mkdirSync(OUT, { recursive: true });
  const ruta = `${OUT}/${nombre}.png`;
  await page.screenshot({ path: ruta });
  console.log("  capturado:", ruta);
}

async function main() {
  const browser = await chromium.launch();
  const token = await cookieDeSesion();

  // Login: sin sesión, para ver el logo apilado de la entrada.
  const anon = await browser.newContext({ viewport: { width: 1000, height: 720 } });
  const pLogin = await anon.newPage();
  await pLogin.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await capturar(pLogin, "logo-login");

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addCookies([
    { name: "authjs.session-token", value: token, domain: "localhost", path: "/" },
  ]);

  // Escritorio: la barra lateral completa, en la pantalla de proyectos.
  const page = await ctx.newPage();
  await page.goto(`${BASE}/proyectos`, { waitUntil: "networkidle" });
  await capturar(page, "logo-sidebar-escritorio");

  // Encabezado solo, ampliado, para mirar el detalle del logo.
  const header = page.locator("aside > div").first();
  mkdirSync(OUT, { recursive: true });
  await header.screenshot({ path: `${OUT}/logo-sidebar-detalle.png` });
  console.log("  capturado:", `${OUT}/logo-sidebar-detalle.png`);

  // Celular: el mismo encabezado dentro del drawer, que es más angosto y lleva
  // además la X de cerrar — el caso donde el logo podría no entrar.
  const mob = await browser.newContext({ viewport: { width: 390, height: 780 } });
  await mob.addCookies([
    { name: "authjs.session-token", value: token, domain: "localhost", path: "/" },
  ]);
  const pm = await mob.newPage();
  await pm.goto(`${BASE}/proyectos`, { waitUntil: "networkidle" });
  await pm.getByLabel("Abrir menú").click();
  await pm.waitForTimeout(400);
  await capturar(pm, "logo-sidebar-celular");

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
