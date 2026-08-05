/**
 * Captura de verificación del pendiente 130: el desplegable de proyecto de la
 * lista de Facturas ya no muestra las obras archivadas.
 *
 * Corre contra el dev local levantado en un worktree APUNTADO A LA BASE VIVA
 * (ep-shy-morning) — MJ lo autorizó explícitamente para poder ver el desplegable
 * con los datos reales, porque la base de dev está caída.
 *
 * SOLO LECTURA, con dos candados:
 *   1. Se abortan en el navegador TODOS los pedidos que no sean GET/HEAD. Aunque
 *      algo dispare un guardado por accidente, no llega nunca al servidor.
 *   2. No se elige ninguna opción del desplegable (el `onChange` del select es
 *      lo único que guarda). Solo se abre y se fotografía.
 *
 * El select es NATIVO: si se abre con un click, el listado lo dibuja macOS y no
 * sale en la captura. Por eso se le pone `size` por DOM, que lo convierte en una
 * lista desplegada dentro de la página. Las opciones son las reales que mandó el
 * servidor — solo cambia cómo se dibujan.
 *
 * Uso: npx tsx scripts/verify-desplegable-130.ts [baseUrl]
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "fs";
import { hkdf } from "@panva/hkdf";

const BASE = process.argv[2] ?? "http://localhost:3130";
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
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
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

  // CANDADO 1: nada que no sea lectura sale del navegador.
  await page.route("**/*", (route) => {
    const m = route.request().method();
    if (m === "GET" || m === "HEAD") return route.continue();
    console.log(`  [BLOQUEADO] ${m} ${route.request().url()}`);
    return route.abort();
  });

  // Timeout largo: con 500 facturas y el dev recién compilado, el primer
  // render de /facturas puede tardar más de 30s.
  await page.goto(`${BASE}/facturas`, {
    waitUntil: "domcontentloaded",
    timeout: 180_000,
  });
  // OJO: la tabla se renderiza dos veces (tarjetas para celular + tabla para
  // escritorio). La primera copia del botón está oculta — hay que ir a la visible.
  const fila = page.locator("tbody tr:visible").first();
  const celda = fila
    .locator('button[title="Click para cambiar proyecto"]')
    .first();
  await celda.waitFor({ state: "visible", timeout: 90_000 });

  // Abrir la celda de proyecto de la primera factura. Esto solo prende un
  // useState local (editing=true) — no pega a la API.
  // El select de la fila, no los de la barra de filtros de arriba.
  const select = fila.locator("select").first();
  // La lista trae 500 filas: el click se pierde si cae antes de que React
  // hidrate. Se reintenta hasta que el select aparezca de verdad.
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(1500);
    await celda.click().catch(() => {});
    if (await select.isVisible().catch(() => false)) break;
  }
  await select.waitFor({ timeout: 15_000 });

  // Leer las opciones REALES que mandó el servidor.
  const opciones = await select.locator("option").allTextContents();
  console.log(`\nOPCIONES DEL DESPLEGABLE (${opciones.length}):`);
  for (const o of opciones) console.log("  " + o.trim());

  const archivadas = [
    "Cocina Rodrigo de Triana",
    "Depto Colon",
    "Los Halcones",
    "Muebles Cruz del Sur",
  ];
  console.log("\nCHEQUEO:");
  for (const n of archivadas)
    console.log(
      `  ${n.padEnd(26)} ${
        opciones.some((o) => o.includes(n)) ? "APARECE  ← MAL" : "no aparece  → OK"
      }`
    );
  for (const n of ["BLARQ", "CASA"])
    console.log(
      `  ${n.padEnd(26)} ${
        opciones.some((o) => o.trim() === n) ? "aparece  → OK" : "NO APARECE  ← MAL"
      }`
    );

  // CANDADO 2 implícito: se despliega por DOM, sin tocar el valor.
  await select.evaluate((el, n) => {
    const s = el as HTMLSelectElement;
    s.size = n;
    s.style.width = "420px";
    s.style.fontSize = "13px";
    // Opaco y por encima: si no, se transparenta la fila de atrás en la foto.
    s.style.background = "#fff";
    s.style.position = "relative";
    s.style.zIndex = "9999";
  }, opciones.length);
  await page.waitForTimeout(400);

  const salida = `${OUT}/${process.env.CAPTURA ?? "130-desplegable-proyecto"}.png`;
  await select.screenshot({ path: salida });
  console.log(`\nCaptura: ${salida}`);

  await browser.close();
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
