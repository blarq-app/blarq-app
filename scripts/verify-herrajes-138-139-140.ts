/**
 * Verificación en pantalla de los pendientes 138 / 139 / 140.
 *
 *   138 — "+ agregar" del catálogo entra la línea de UN clic.
 *   139 — los nombres de herraje se muestran en estilo oración.
 *   140 — se arrastran los componentes y las líneas de herraje, y el orden
 *         queda GUARDADO (se recarga la página y se vuelve a leer).
 *
 * Corre contra la base de DESARROLLO (ep-solitary-mud), nunca la viva. La app
 * está detrás del login y en dev no se puede tipear la clave a mano, así que se
 * firma una cookie de sesión con el NEXTAUTH_SECRET del .env (mismo truco que
 * scripts/verify-archivar-cotizacion.ts).
 *
 * dnd-kit NO reacciona a un drag sintético tipo mouse.move directo: hay que
 * mandar pointerdown/pointermove/pointerup reales y pasar el umbral de 5px del
 * sensor (lección del PR #209). Y hay que ESPERAR la respuesta del PATCH antes
 * de recargar, o se lee la base antes de que la escritura llegue.
 *
 * Correr con:  npx tsx scripts/verify-herrajes-138-139-140.ts [url]
 */
import { readFileSync, mkdirSync } from "fs";
import { chromium, type Page, type Locator } from "playwright";
import hkdf from "@panva/hkdf";

const BASE = process.argv[2] ?? "http://localhost:3143";
const OUT = "scripts/_capturas";

// Cotización de muebles con 7 componentes en la partida MUEBLES (base dev).
const PROYECTO = "cmoj9qhwl0004rtpz5oe3qnll";
const PRESUPUESTO = "cmot430wx007brtnrgmh4vmra";
const URL = `${BASE}/proyectos/${PROYECTO}/presupuesto/${PRESUPUESTO}`;

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
    64,
  );
  return await new EncryptJWT({
    name: "MJ Blanco",
    email: "mjblanco@blarq.cl",
    sub: "verificacion",
  })
    .setProtectedHeader({ alg: "dir", enc: "A256CBC-HS512" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .setJti("verificacion-herrajes")
    .encrypt(key);
}

async function foto(target: Page | Locator, nombre: string) {
  mkdirSync(OUT, { recursive: true });
  await target.screenshot({ path: `${OUT}/${nombre}.png` });
  console.log(`  foto → ${OUT}/${nombre}.png`);
}

// Arrastre real para dnd-kit: pointerdown, varios pointermove (el primero pasa
// el umbral de 5px del PointerSensor) y pointerup. Espera la respuesta del
// endpoint de reorder antes de devolver, así el que llama puede recargar.
async function arrastrar(
  page: Page,
  desde: Locator,
  hasta: Locator,
  endpoint: string,
) {
  const a = (await desde.boundingBox())!;
  const b = (await hasta.boundingBox())!;
  const x0 = a.x + a.width / 2;
  const y0 = a.y + a.height / 2;
  const x1 = b.x + b.width / 2;
  const y1 = b.y + b.height / 2;

  const respuesta = page.waitForResponse(
    (r) => r.url().includes(endpoint) && r.request().method() === "PATCH",
    { timeout: 30000 },
  );

  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0, y0 + 8, { steps: 4 });
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * i) / 12);
    await page.waitForTimeout(20);
  }
  await page.mouse.move(x1, y1);
  await page.waitForTimeout(120);
  await page.mouse.up();

  const res = await respuesta;
  console.log(`  ${endpoint} → ${res.status()}`);
  await page.waitForTimeout(300);
}

const componentes = (page: Page) =>
  page
    .locator('input[placeholder="COMPONENTE"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

// Los nombres de línea de herraje son los únicos textarea con resize-none
// (el de Observaciones es resize-y).
const lineasHerraje = (page: Page) =>
  page
    .locator("textarea.resize-none")
    .evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));

function ok(cond: boolean, msg: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  const token = await cookieDeSesion();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
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
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  [console error]", m.text());
  });

  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  // ── 140-a · COMPONENTES ────────────────────────────────────────────────
  console.log("\n══ 140 · arrastrar COMPONENTES ══");
  const compAntes = await componentes(page);
  console.log("  antes:", compAntes.slice(0, 7).join(" | "));
  await foto(page.locator("main"), "140-componentes-antes");

  const filaComp = (i: number) =>
    page.locator('input[placeholder="COMPONENTE"]').nth(i);
  const manijaComp = (i: number) =>
    filaComp(i).locator("xpath=preceding-sibling::span[1]");

  // Subir el 3er componente al 1er lugar.
  await arrastrar(page, manijaComp(2), filaComp(0), "/muebles/details/reorder");
  const compDespues = await componentes(page);
  console.log("  después:", compDespues.slice(0, 7).join(" | "));
  await foto(page.locator("main"), "140-componentes-despues");
  ok(compAntes.join("|") !== compDespues.join("|"), "el arrastre movió la fila");

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const compRecarga = await componentes(page);
  console.log("  tras recargar:", compRecarga.slice(0, 7).join(" | "));
  ok(
    compDespues.join("|") === compRecarga.join("|"),
    "el orden de los componentes quedó GUARDADO",
  );

  // ── 138 + 139 · CATÁLOGO DE HERRAJES ───────────────────────────────────
  console.log("\n══ 138 · agregar del catálogo en UN clic ══");

  // Si el capítulo todavía no tiene partida de herrajes, crearla.
  const crearPartida = page
    .getByRole("button", { name: /Partida de herrajes/ })
    .first();
  if (await crearPartida.count()) {
    await crearPartida.click();
    await page.waitForTimeout(1500);
  }

  await page.getByRole("button", { name: "Agregar del catálogo" }).first().click();
  await page.waitForTimeout(2500);

  const modal = page.locator("h3", { hasText: "Agregar herraje del catálogo" });
  await modal.waitFor();
  const cajaModal = modal.locator("xpath=ancestor::div[1]/..");
  await foto(cajaModal, "138-catalogo-un-clic");

  // Los nombres del catálogo ya salen en estilo oración (139).
  const nombresCatalogo = await cajaModal
    .locator(".font-semibold.text-gray-900.leading-tight")
    .evaluateAll((els) => els.slice(0, 6).map((e) => e.textContent!.trim()));
  console.log("  nombres en el catálogo (139):");
  for (const n of nombresCatalogo) console.log(`    ${n}`);

  const botones = cajaModal.getByRole("button", { name: "+ agregar" });
  console.log(`  filas con "+ agregar": ${await botones.count()}`);

  const lineasIniciales = (await lineasHerraje(page)).length;
  // Dos de DPH (mezcla Title Case / oración) y dos de HBT (todo MAYÚSCULA en
  // la base): así la partida muestra los dos orígenes ya homologados.
  for (const i of [0, 20]) {
    await cajaModal.getByRole("button", { name: "+ agregar" }).nth(i).click();
    await page.waitForTimeout(1200);
  }
  await foto(cajaModal, "138-catalogo-un-clic-agregado");

  await cajaModal.getByRole("button", { name: "HBT", exact: true }).click();
  await page.waitForTimeout(1500);
  for (const i of [0, 5]) {
    await cajaModal.getByRole("button", { name: "+ agregar" }).nth(i).click();
    await page.waitForTimeout(1200);
  }
  await foto(cajaModal, "138-catalogo-hbt");

  const lineas = await lineasHerraje(page);
  console.log("  líneas en la partida (139 · estilo oración):");
  for (const l of lineas) console.log(`    ${l}`);
  ok(
    lineas.length === lineasIniciales + 4,
    `entraron 4 líneas de un clic cada una (${lineasIniciales} → ${lineas.length})`,
  );
  ok(
    lineas.every((l) => l === l.charAt(0).toUpperCase() + l.slice(1)),
    "los nombres arrancan en mayúscula",
  );
  ok(
    !lineas.some((l) => l.slice(1) === l.slice(1).toUpperCase() && /[A-Z]/.test(l.slice(1))),
    "ningún nombre quedó todo en MAYÚSCULA",
  );

  // Cerrar el catálogo para ver la partida limpia.
  await page.getByRole("button", { name: "Cerrar catálogo" }).first().click();
  await page.waitForTimeout(500);

  // ── 140-b · LÍNEAS DE HERRAJE ──────────────────────────────────────────
  console.log("\n══ 140 · arrastrar LÍNEAS DE HERRAJE ══");
  const herrAntes = await lineasHerraje(page);
  await foto(page.locator("main"), "140-herrajes-antes");

  const filaHerr = (i: number) => page.locator("textarea.resize-none").nth(i);
  const manijaHerr = (i: number) =>
    filaHerr(i).locator("xpath=preceding-sibling::span[1]/span");

  await arrastrar(page, manijaHerr(2), filaHerr(0), "/herrajes/reorder");
  const herrDespues = await lineasHerraje(page);
  console.log("  antes:  ", herrAntes.join(" | "));
  console.log("  después:", herrDespues.join(" | "));
  await foto(page.locator("main"), "140-herrajes-despues");
  ok(herrAntes.join("|") !== herrDespues.join("|"), "el arrastre movió la línea");

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const herrRecarga = await lineasHerraje(page);
  console.log("  tras recargar:", herrRecarga.join(" | "));
  ok(
    herrDespues.join("|") === herrRecarga.join("|"),
    "el orden de las líneas quedó GUARDADO",
  );

  await foto(page.locator("main"), "138-139-140-partida-final");
  await browser.close();
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
