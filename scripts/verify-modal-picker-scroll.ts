/**
 * Captura del modal "Asignar a factura" (conciliación masiva) para verificar
 * en pantalla que la lista scrollea dentro del modal en vez de cortarse.
 *
 * Abre /banco/movimientos, selecciona un par de movimientos, abre el menú
 * "Resolver" → "Conciliar contra una factura…", apaga los filtros para que
 * la lista traiga MUCHAS facturas (que es cuando se ve el bug) y captura:
 *   - <nombre>-arriba.png  → el modal recién abierto
 *   - <nombre>-abajo.png   → después de scrollear la lista hasta el final
 *
 * Ventana chica a propósito (900px de alto): así el 85vh del modal queda
 * más corto que la lista y el desborde salta a la vista.
 *
 * Uso: npx tsx scripts/verify-modal-picker-scroll.ts <nombre> [baseUrl]
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "fs";
import { hkdf } from "@panva/hkdf";

const NOMBRE = process.argv[2] ?? "modal";
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

async function main() {
  mkdirSync(OUT, { recursive: true });
  const token = await cookieDeSesion();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addCookies([
    { name: "authjs.session-token", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  const page = await ctx.newPage();

  // Ingresos: así el modal busca facturas EMITIDAS, que es el caso que reportó MJ.
  await page.goto(`${BASE}/banco/movimientos?tipo=ingreso`, { waitUntil: "networkidle" });

  // Seleccionar los dos primeros movimientos seleccionables.
  const checks = page.locator('input[aria-label="Seleccionar movimiento"]');
  await checks.first().waitFor({ timeout: 30000 });
  const n = await checks.count();
  console.log(`movimientos seleccionables: ${n}`);
  await checks.nth(0).check();
  if (n > 1) await checks.nth(1).check();

  // Barra de selección (fija abajo-centro) → "Resolver" → "Conciliar contra
  // una factura…". OJO: cada FILA tiene su propio "Resolver"; hay que tomar
  // el de la barra, no el primero del DOM.
  await page
    .locator("div.fixed.bottom-4")
    .getByRole("button", { name: /Resolver/ })
    .click();
  await page.waitForTimeout(600);
  await page.getByText(/Conciliar contra una factura/).first().click();

  const modal = page.locator("text=Asignar a factura").first();
  await modal.waitFor({ timeout: 15000 });

  // Apagar los filtros para traer la lista larga (es el caso que se corta).
  for (const etiqueta of ["Mismo cliente", "Mismo proveedor", "Solo con saldo"]) {
    const cb = page.getByText(etiqueta, { exact: false }).locator('input[type="checkbox"]');
    if (await cb.count()) {
      const c = cb.first();
      if (await c.isChecked()) await c.uncheck();
    }
  }
  await page.waitForTimeout(1500);

  const filas = await page.locator("table tbody tr").count();
  console.log(`facturas en la lista: ${filas}`);

  await page.screenshot({ path: `${OUT}/${NOMBRE}-arriba.png` });
  console.log(`captura: ${OUT}/${NOMBRE}-arriba.png`);

  // Intentar scrollear la lista hasta el fondo — con el bug no hay nada que
  // scrollear (el contenido desborda y el modal lo recorta).
  const caja = page.locator("div.overflow-y-auto").last();
  const info = await caja.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
  });
  console.log(`scroll: ${JSON.stringify(info)}  (scrollTop 0 con scrollHeight>clientHeight = no scrollea)`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${NOMBRE}-abajo.png` });
  console.log(`captura: ${OUT}/${NOMBRE}-abajo.png`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
