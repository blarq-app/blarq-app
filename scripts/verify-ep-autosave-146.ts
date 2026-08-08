/**
 * Verificación en pantalla del pendiente 146 — el editor del EP guarda solo.
 *
 * Reproduce el caso que le costó trabajo real a MJ: cargar avances, salir de la
 * pantalla sin apretar nada, y volver. Antes se perdían; acá se comprueba que
 * quedan.
 *
 * Corre contra la base de DESARROLLO (ep-solitary-mud), nunca la viva. La app
 * está detrás del login y en dev no se puede tipear la clave a mano, así que se
 * firma una cookie de sesión con el NEXTAUTH_SECRET del .env (mismo truco que
 * scripts/verify-herrajes-138-139-140.ts).
 *
 * Correr con:  npx tsx scripts/verify-ep-autosave-146.ts [url]
 */
import { readFileSync, mkdirSync } from "fs";
import { chromium, type Page, type Locator } from "playwright";
import hkdf from "@panva/hkdf";

const BASE = process.argv[2] ?? "http://localhost:3146";
const OUT = "scripts/_capturas";

// EP #1 de Lefevre en la base dev: borrador, 51 partidas (mismo orden de
// magnitud que el EP 2 de Paseo del Sena que perdió MJ).
const PROYECTO = "cmnx59uvq0000rty9ouec5i25";
const EP = "cmogflose0001rt2r83bvn2eu";
const URL = `${BASE}/proyectos/${PROYECTO}/estados-pago/${EP}`;
const URL_LISTA = `${BASE}/proyectos/${PROYECTO}/estados-pago`;

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
    .setJti("verificacion-ep-autosave")
    .encrypt(key);
}

async function foto(target: Page | Locator, nombre: string) {
  mkdirSync(OUT, { recursive: true });
  await target.screenshot({ path: `${OUT}/${nombre}.png` });
  console.log(`   foto → ${OUT}/${nombre}.png`);
}

// Los dos números de plata que MJ mira: lo que suma este EP y el acumulado.
async function leerTotales(page: Page) {
  const filas = page.locator("table tbody tr");
  const esteEp = (await filas.nth(await contarPrevios(page)).innerText())
    .split("\n")
    .pop()!;
  const acumulado = (await filas.last().innerText()).split("\n").pop()!;
  return { esteEp: esteEp.trim(), acumulado: acumulado.trim() };
}

async function contarPrevios(page: Page) {
  const filas = await page.locator("table tbody tr").count();
  return filas - 2; // las dos últimas son "este EP" y el total acumulado
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
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

  // Traza de lo que sale al servidor, para poder diagnosticar sin adivinar.
  const patches: string[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/api/estados-pago/")) {
      patches.push(`${r.request().method()} ${r.status()}`);
    }
  });
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`   [consola] ${m.text().slice(0, 160)}`);
  });
  page.on("pageerror", (e) => console.log(`   [error JS] ${String(e).slice(0, 200)}`));

  console.log("1. Abriendo el EP…");
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Total mano de obra");

  // ── El botón "Guardar cambios" ya no existe ──────────────────────────
  const hayBotonGuardar = await page.getByRole("button", { name: /Guardar cambios|^Guardado$/ }).count();
  console.log(`   ¿botón "Guardar cambios"? → ${hayBotonGuardar === 0 ? "NO (correcto)" : "SÍ ⚠"}`);

  const totalesAntes = await leerTotales(page);
  console.log(`   totales en pantalla: este EP ${totalesAntes.esteEp} | acumulado ${totalesAntes.acumulado}`);
  await foto(page.locator("div.bg-white.rounded-xl").first(), "146-1-encabezado-sin-boton-guardar");

  // ── Cargar un avance y ver la señal ──────────────────────────────────
  const inputs = page.locator('input[type="number"]');
  const cuantos = await inputs.count();
  console.log(`\n2. Cargando avances (${cuantos} partidas editables)…`);

  const primero = inputs.first();
  const valorOriginal = await primero.inputValue();
  const nuevo = valorOriginal === "35" ? "40" : "35";
  await primero.click();
  await primero.fill(nuevo);
  console.log(`   partida 1: ${valorOriginal}% → ${nuevo}%  (sin apretar ningún botón)`);
  await primero.press("Tab"); // salir del campo = guardar

  await page.waitForSelector("text=✓ guardado", { timeout: 10000 });
  console.log('   apareció "✓ guardado" ✔');
  await foto(page.locator("div.bg-white.rounded-xl").first(), "146-2-senal-guardado");

  // Un segundo avance, en otra partida, para probar dos ediciones seguidas.
  const segundo = inputs.nth(1);
  const orig2 = await segundo.inputValue();
  const nuevo2 = orig2 === "60" ? "70" : "60";
  await segundo.click();
  await segundo.fill(nuevo2);
  await segundo.press("Tab");
  console.log(`   partida 2: ${orig2}% → ${nuevo2}%`);
  await page.waitForTimeout(1500);

  const totalesTrasEditar = await leerTotales(page);
  console.log(`   totales tras editar: este EP ${totalesTrasEditar.esteEp} | acumulado ${totalesTrasEditar.acumulado}`);

  // ── Prueba 1: RECARGAR la página ─────────────────────────────────────
  console.log("\n3. Recargando la página (F5)…");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("text=Total mano de obra");
  const tras1 = await page.locator('input[type="number"]').first().inputValue();
  const tras2 = await page.locator('input[type="number"]').nth(1).inputValue();
  console.log(`   partida 1 = ${tras1}%  (esperado ${nuevo}%)  ${tras1 === nuevo ? "✔" : "✗"}`);
  console.log(`   partida 2 = ${tras2}%  (esperado ${nuevo2}%) ${tras2 === nuevo2 ? "✔" : "✗"}`);

  const totalesTrasRecarga = await leerTotales(page);
  console.log(`   totales tras recargar: este EP ${totalesTrasRecarga.esteEp} | acumulado ${totalesTrasRecarga.acumulado}`);
  const plataIgual =
    totalesTrasRecarga.esteEp === totalesTrasEditar.esteEp &&
    totalesTrasRecarga.acumulado === totalesTrasEditar.acumulado;
  console.log(`   ¿la plata da lo mismo antes y después de recargar? ${plataIgual ? "SÍ ✔" : "NO ✗"}`);
  await foto(page, "146-3-tras-recargar");

  // ── Prueba 2: el caso de MJ — SALIR de la pantalla sin apretar nada ──
  console.log("\n4. El caso de MJ: cargar un avance y SALIR sin apretar nada…");
  const tercero = page.locator('input[type="number"]').nth(2);
  const orig3 = await tercero.inputValue();
  const nuevo3 = orig3 === "80" ? "90" : "80";
  await tercero.click();
  await tercero.fill(nuevo3);
  console.log(`   partida 3: ${orig3}% → ${nuevo3}%`);

  // Salir por el link de arriba, como haría MJ. El clic dispara el blur.
  await page.getByRole("link", { name: /Estados de Pago/ }).first().click();
  await page.waitForURL(URL_LISTA, { timeout: 10000 });
  console.log("   salió a la lista de Estados de Pago");
  await page.waitForTimeout(1500);

  console.log("   volviendo al EP…");
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Total mano de obra");
  const tras3 = await page.locator('input[type="number"]').nth(2).inputValue();
  console.log(`   partida 3 = ${tras3}%  (esperado ${nuevo3}%)  ${tras3 === nuevo3 ? "✔ SIGUE AHÍ" : "✗ SE PERDIÓ"}`);
  await foto(page, "146-4-volviendo-sigue-ahi");

  // ── Prueba 3: varias filas seguidas, rápido ──────────────────────────
  // El gotcha del PR #202: dos guardados en vuelo a la vez se pisaban y una
  // fila volvía sola a su valor viejo. Acá se tabula por 5 partidas sin pausa.
  console.log("\n5. Cinco partidas seguidas, tabulando rápido…");
  const esperados: string[] = [];
  for (let n = 3; n < 8; n++) {
    const inp = page.locator('input[type="number"]').nth(n);
    // Siempre DISTINTO a lo que ya está guardado: si se manda el mismo número,
    // el editor no guarda nada (y con razón) y la prueba no probaría nada.
    const actual = parseFloat(await inp.inputValue()) || 0;
    const v = String(actual >= 50 ? actual - 13 : actual + 13);
    esperados.push(v);
    await inp.click();
    await inp.fill(v);
    await inp.press("Tab");
  }
  console.log(`   cargadas: ${esperados.map((v) => v + "%").join(", ")}`);
  // "✓ guardado" ahora significa "no queda ningún guardado por mandar": la
  // señal se prende recién cuando se vacía la cola.
  try {
    await page.waitForSelector("text=✓ guardado", { timeout: 15000 });
    console.log('   apareció "✓ guardado" (cola vacía)');
  } catch {
    const enc = await page.locator("div.bg-white.rounded-xl").first().innerText();
    console.log(`   ⚠ no apareció la señal. Encabezado dice:\n${enc.split("\n").slice(-4).join(" | ")}`);
    console.log(`   PATCHes vistos: ${patches.length} → ${patches.join(", ")}`);
    await foto(page.locator("div.bg-white.rounded-xl").first(), "146-debug-sin-senal");
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("text=Total mano de obra");
  let todasOk = true;
  for (let n = 3; n < 8; n++) {
    const leido = await page.locator('input[type="number"]').nth(n).inputValue();
    const esperado = esperados[n - 3];
    if (leido !== esperado) todasOk = false;
    console.log(`   partida ${n + 1} = ${leido}% (esperado ${esperado}%) ${leido === esperado ? "✔" : "✗"}`);
  }
  console.log(`   ¿ninguna se pisó? ${todasOk ? "SÍ ✔" : "NO ✗"}`);

  // ── Prueba 4: el tope sigue avisando ─────────────────────────────────
  // En modo cantidad se puede tipear más de lo presupuestado. Tiene que
  // aparecer el aviso Y el campo volver a lo que estaba (no puede quedar
  // mostrando un número que no se guardó).
  console.log("\n6. Tope de validación (modo cantidad, número imposible)…");
  await page.locator("button[title^='Cambiar a cantidad']").first().click();
  const campoQty = page.locator('input[type="number"]').first();
  const qtyAntes = await campoQty.inputValue();
  await campoQty.click();
  await campoQty.fill("999999");
  await campoQty.press("Tab");
  await page.waitForTimeout(800);
  const hayAviso = await page.locator("text=/No se puede ejecutar más cantidad/").count();
  const qtyDespues = await campoQty.inputValue();
  console.log(`   ¿avisa? ${hayAviso > 0 ? "SÍ ✔" : "NO ✗"}`);
  console.log(`   campo volvió a ${qtyDespues} (era ${qtyAntes}) ${qtyDespues === qtyAntes ? "✔" : "✗"}`);
  await foto(page.locator("div.bg-white.rounded-xl").nth(1), "146-5-tope-avisa-y-vuelve");
  const topeOk = hayAviso > 0 && qtyDespues === qtyAntes;

  // ── Resumen ──────────────────────────────────────────────────────────
  const ok =
    hayBotonGuardar === 0 &&
    tras1 === nuevo &&
    tras2 === nuevo2 &&
    tras3 === nuevo3 &&
    plataIgual &&
    todasOk &&
    topeOk;
  console.log(`\n${ok ? "TODO OK ✔" : "HAY ALGO MAL ✗"}`);

  await browser.close();
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
