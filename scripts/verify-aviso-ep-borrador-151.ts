/**
 * Verificación del aviso al crear un EP con el anterior en borrador (#151).
 *
 * El riesgo que previene, medido en dev: un EP nuevo arranca desde el último EP
 * CERRADO, así que no ve lo cargado en un borrador abierto. Con dos borradores
 * sobre las mismas partidas, el mismo trabajo se paga dos veces
 * (ver scripts/diag-151-doble-pago-borradores.ts).
 *
 * Comprueba las tres situaciones:
 *   1. sin EPs        → no avisa (no hay nada que pisar);
 *   2. con un borrador abierto → AVISA, y si se cancela NO crea nada;
 *   3. el mismo caso, aceptando → crea igual (avisa, no bloquea).
 *
 * Corre contra la base de DESARROLLO y limpia lo suyo al empezar y al terminar.
 *
 * Correr con:  npx tsx scripts/verify-aviso-ep-borrador-151.ts [url]
 */
import { readFileSync, mkdirSync } from "fs";
import { chromium, type Page, type APIRequestContext } from "playwright";
import hkdf from "@panva/hkdf";

const BASE = process.argv[2] ?? "http://localhost:3146";
const OUT = "scripts/_capturas";
const PROYECTO = "cmoj9qhwe0000rtpz4wdb64cn";
const MAESTRO = "cmrlc2cpz0000rtw9wm2yg358";
const URL = `${BASE}/proyectos/${PROYECTO}/estados-pago/maestro/${MAESTRO}`;

const env = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const SECRET = env.match(/NEXTAUTH_SECRET\s*=\s*"?([^"\n]+)"?/)![1].trim();

async function cookie(): Promise<string> {
  const { EncryptJWT } = await import("jose");
  const salt = "authjs.session-token";
  const key = await hkdf("sha256", SECRET, salt, `Auth.js Generated Encryption Key (${salt})`, 64);
  return await new EncryptJWT({ name: "MJ Blanco", email: "mjblanco@blarq.cl", sub: "verificacion" })
    .setProtectedHeader({ alg: "dir", enc: "A256CBC-HS512" })
    .setIssuedAt().setExpirationTime("1h").setJti("verify-151").encrypt(key);
}

async function limpiar(api: APIRequestContext) {
  const prev = await (await api.get(`${BASE}/api/proyectos/${PROYECTO}/estados-pago`)).json();
  for (const e of (Array.isArray(prev) ? prev : []).filter((x: { maestroId: string | null }) => x.maestroId === MAESTRO)) {
    await api.delete(`${BASE}/api/estados-pago/${e.id}`);
  }
}
async function cuantosEps(api: APIRequestContext) {
  const prev = await (await api.get(`${BASE}/api/proyectos/${PROYECTO}/estados-pago`)).json();
  return (Array.isArray(prev) ? prev : []).filter((x: { maestroId: string | null }) => x.maestroId === MAESTRO).length;
}

// Captura el texto del confirm() y responde lo que se le pida.
function interceptarAviso(page: Page, aceptar: boolean, capturado: { texto: string }) {
  page.on("dialog", async (d) => {
    capturado.texto = d.message();
    if (aceptar) await d.accept();
    else await d.dismiss();
  });
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await ctx.addCookies([{ name: "authjs.session-token", value: await cookie(), domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  const api = ctx.request;
  await limpiar(api);

  // ── 1. Sin EPs: no tiene que avisar ───────────────────────────────────
  console.log("1. Primer EP del maestro (no hay ninguno en borrador)…");
  let page = await ctx.newPage();
  const cap1 = { texto: "" };
  interceptarAviso(page, true, cap1);
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "+ Nuevo EP" }).click();
  await page.waitForURL(/estados-pago\/[a-z0-9]+$/, { timeout: 15000 });
  console.log(`   ¿avisó? ${cap1.texto ? "SÍ ✗ (no debía)" : "NO ✔"}`);
  console.log(`   EPs ahora: ${await cuantosEps(api)} (esperado 1)`);
  await page.close();

  // ── 2. Con un borrador abierto: avisa, y si se cancela no crea ────────
  console.log("\n2. Segundo EP con el #1 TODAVÍA en borrador — se CANCELA…");
  page = await ctx.newPage();
  const cap2 = { texto: "" };
  interceptarAviso(page, false, cap2);
  await page.goto(URL, { waitUntil: "networkidle" });
  const antes = await cuantosEps(api);
  await page.getByRole("button", { name: "+ Nuevo EP" }).click();
  await page.waitForTimeout(1500);
  const despues = await cuantosEps(api);
  console.log(`   ¿avisó? ${cap2.texto ? "SÍ ✔" : "NO ✗"}`);
  if (cap2.texto) console.log("   ── texto del aviso ──\n" + cap2.texto.split("\n").map((l) => "   | " + l).join("\n"));
  console.log(`   EPs antes ${antes} → después ${despues} ${antes === despues ? "✔ no creó nada" : "✗ creó igual"}`);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/151-1-aviso-ep-en-borrador.png` });
  await page.close();

  // ── 3. Mismo caso, aceptando: crea igual (avisa, no bloquea) ─────────
  console.log("\n3. Mismo caso pero ACEPTANDO (tiene que dejar seguir)…");
  page = await ctx.newPage();
  const cap3 = { texto: "" };
  interceptarAviso(page, true, cap3);
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "+ Nuevo EP" }).click();
  await page.waitForURL(/estados-pago\/[a-z0-9]+$/, { timeout: 15000 });
  const final = await cuantosEps(api);
  console.log(`   ¿avisó? ${cap3.texto ? "SÍ ✔" : "NO ✗"}`);
  console.log(`   EPs ahora: ${final} (esperado 2) ${final === 2 ? "✔ dejó seguir" : "✗"}`);
  await page.close();

  const ok = !cap1.texto && !!cap2.texto && antes === despues && !!cap3.texto && final === 2;
  console.log(`\n${ok ? "TODO OK ✔" : "REVISAR ✗"}`);
  await limpiar(api);
  console.log("(base dev limpia)");
  await browser.close();
  if (!ok) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
