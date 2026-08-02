/**
 * Capturas de la columna Respaldo para un movimiento conciliado a 25 facturas
 * (sembrado con scripts/seed-mov-multi-pago.ts).
 *
 * Uso: npx tsx scripts/verify-detalle-pagos.ts <nombre> [--abrir] [baseUrl]
 *   <nombre>   prefijo del archivo (ej. "antes" / "despues")
 *   --abrir    clickea "N pagos" y captura el desplegable abierto
 *
 * Sale en scripts/_capturas/detalle-pagos-<nombre>.png (fila) y
 * -pantalla.png (la pantalla entera, para ver el desplegable completo).
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "fs";
import { hkdf } from "@panva/hkdf";

const NOMBRE = process.argv[2] ?? "captura";
const ABRIR = process.argv.includes("--abrir");
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3079";
const MOV_ID =
  process.argv.find((a) => a.startsWith("--mov="))?.slice(6) ??
  "cmsbz6isk0001rtu4fl1u9431";
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

  // Drill-down por id: la lista muestra SOLO el movimiento de prueba.
  await page.goto(`${BASE}/banco/movimientos?id=${MOV_ID}`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector("table tbody tr", { timeout: 30_000 });

  if (ABRIR) {
    // El resumen "25 pagos · $…" es ahora un botón.
    const boton = page.getByRole("button", { name: /pagos ·/ });
    await boton.click();
    await page.waitForSelector('[role="dialog"]', { timeout: 10_000 });
    await page.waitForTimeout(300);
  }

  const fila = page.locator("table tbody tr").first();
  await fila.screenshot({ path: `${OUT}/detalle-pagos-${NOMBRE}-fila.png` });
  await page.screenshot({ path: `${OUT}/detalle-pagos-${NOMBRE}-pantalla.png` });

  // Chequeos duros con el desplegable abierto: que estén las 25 líneas, que se
  // pueda scrollear hasta la última y que el link abra la factura de verdad.
  if (ABRIR) {
    const links = page.locator('[role="dialog"] a');
    console.log(`líneas linkeables en el desplegable: ${await links.count()}`);

    const lista = page.locator('[role="dialog"] .overflow-y-auto');
    await lista.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/detalle-pagos-${NOMBRE}-scroll.png` });
    const ultima = await links.last().innerText();
    console.log(`última línea visible tras scrollear: ${ultima.replace(/\n/g, " · ")}`);

    // Click en la primera factura → tiene que llegar a /facturas?invoiceId=…
    const href = await links.first().getAttribute("href");
    await links.first().click();
    await page.waitForURL(/facturas\?invoiceId=/, { timeout: 15_000 });
    console.log(`link OK → ${href} · terminó en ${new URL(page.url()).pathname}${new URL(page.url()).search}`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/detalle-pagos-${NOMBRE}-click.png` });
  }

  console.log(`capturas: ${OUT}/detalle-pagos-${NOMBRE}-*.png`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
