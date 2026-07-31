/**
 * Captura del menú "Resolver ▾" abierto desde la barra de selección (abajo) y
 * desde una fila, para verificar que el desplegable queda PEGADO a su botón y
 * no flotando lejos.
 *
 * Mide el hueco entre el borde del menú y el borde del botón: tiene que ser de
 * unos pocos píxeles en los dos casos.
 *
 * Uso: npx tsx scripts/verify-menu-resolver-posicion.ts <nombre> [baseUrl]
 */
import { chromium, type Page } from "playwright";
import { readFileSync, mkdirSync } from "fs";
import { hkdf } from "@panva/hkdf";

const NOMBRE = process.argv[2] ?? "menu";
const BASE = process.argv[3] ?? "http://localhost:3050";
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
    .setJti("verificacion")
    .encrypt(key);
}

// Distancia entre el menú abierto y el botón que lo disparó.
async function medirHueco(page: Page) {
  return await page.evaluate(`(() => {
    const menu = document.querySelector('[role="menu"]');
    const btn = document.querySelector('button[aria-expanded="true"]');
    if (!menu || !btn) return { error: "no encontrado" };
    const m = menu.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    // Si el menú abre hacia arriba, el hueco es entre su base y el techo del
    // botón; si abre hacia abajo, entre su techo y la base del botón.
    const abreArriba = m.top < b.top;
    return {
      abreArriba,
      hueco: Math.round(abreArriba ? b.top - m.bottom : m.top - b.bottom),
      menu: { top: Math.round(m.top), bottom: Math.round(m.bottom), h: Math.round(m.height) },
      boton: { top: Math.round(b.top), bottom: Math.round(b.bottom) },
    };
  })()`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
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
  await page.goto(`${BASE}/banco/movimientos?tipo=ingreso`, { waitUntil: "networkidle" });

  // ── Caso 1: el menú de la BARRA de selección (abre hacia arriba) ──────────
  const checks = page.locator('input[aria-label="Seleccionar movimiento"]');
  await checks.first().waitFor({ timeout: 30000 });
  await checks.nth(0).check();
  await checks.nth(1).check();
  await page
    .locator("div.fixed.bottom-4")
    .getByRole("button", { name: /Resolver/ })
    .click();
  await page.waitForTimeout(600);
  console.log("barra:", JSON.stringify(await medirHueco(page)));
  await page.screenshot({ path: `${OUT}/${NOMBRE}-barra.png` });
  console.log(`captura: ${OUT}/${NOMBRE}-barra.png`);

  // ── Caso 2: el menú de una FILA (abre hacia abajo) ────────────────────────
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const filaBtn = page.locator("table tbody").getByRole("button", { name: /Resolver/ }).first();
  // Acomodar la fila ANTES de abrir: el menú se cierra solo al scrollear, así
  // que si el click arrastra la página el menú se cierra en el mismo gesto.
  await filaBtn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await filaBtn.click();
  await page.waitForTimeout(600);
  console.log("fila:", JSON.stringify(await medirHueco(page)));
  await page.screenshot({ path: `${OUT}/${NOMBRE}-fila.png` });
  console.log(`captura: ${OUT}/${NOMBRE}-fila.png`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
