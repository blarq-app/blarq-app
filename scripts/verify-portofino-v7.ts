/**
 * Capturas de la obra V7 de Portofino ya cargada, para que MJ apruebe mirando
 * la app y no el código (§4.10).
 *
 * Levanta un Chromium contra el dev server de este worktree —que apunta a la
 * base VIVA— y se autentica firmando la cookie de NextAuth, igual que
 * `verify-capitulos-obra.ts`. Solo NAVEGA y saca fotos: no hace un solo click
 * que escriba.
 *
 * Saca: el itemizado de la V7 (arriba, el capítulo de sanitarias con sus
 * sub-títulos, y el final de Adicionales con las no cobradas y el descuento),
 * el Cuadro Resumen del proyecto, y de yapa la V6 para el antes/después.
 *
 * Uso: npx tsx scripts/verify-portofino-v7.ts [baseUrl]
 */
import { chromium, type Page } from "playwright";
import { readFileSync, mkdirSync } from "fs";
import { hkdf } from "@panva/hkdf";

const BASE = process.argv[2] ?? "http://localhost:3101";
const OUT = "scripts/_capturas";

const PROYECTO = "cmoj9qhwe0000rtpz4wdb64cn";
const V7 = "cms7xldpz0001rtz5ch8sln3k";
const V6 = "cmp7q1d2j0001rt19pfnn014m";

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

async function foto(page: Page, nombre: string, completa = false) {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${nombre}.png`, fullPage: completa });
  console.log(`  captura: ${OUT}/${nombre}.png`);
}

async function irA(page: Page, ruta: string) {
  await page.goto(`${BASE}${ruta}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
}

async function main() {
  const token = await cookieDeSesion();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
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
  page.on("pageerror", (e) => console.log("  [error de página]", e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) console.log(`  [${r.status()}]`, r.url());
  });

  // ── Itemizado de la V7 ───────────────────────────────────────────────────
  await irA(page, `/proyectos/${PROYECTO}/presupuesto/${V7}`);
  await foto(page, "portofino-v7-itemizado-arriba");

  const texto = await page.evaluate(() => document.body.innerText);
  for (const buscado of [
    "DESCUENTO SEGÚN ACUERDO",
    "COCINA",
    "BAÑOS",
    "TOPE DE PUERTA",
    "REEMBOLSO PARTE VEHICULAR",
  ]) {
    console.log(`  ¿aparece "${buscado}"? ${texto.includes(buscado) ? "sí" : "NO"}`);
  }

  // El capítulo de sanitarias, para ver los sub-títulos COCINA / BAÑOS.
  const sanitarias = page.getByText("MODIFICACION TUBERIA GAS").first();
  await sanitarias.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await foto(page, "portofino-v7-subcapitulos");

  // El final de Adicionales: las no cobradas y el descuento.
  const descuento = page.getByText("DESCUENTO SEGÚN ACUERDO").first();
  await descuento.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await foto(page, "portofino-v7-no-cobradas-y-descuento");

  // La página entera, por si MJ quiere revisar partida por partida.
  await foto(page, "portofino-v7-itemizado-completo", true);

  // ── Cuadro Resumen del proyecto (el después) ─────────────────────────────
  await irA(page, `/proyectos/${PROYECTO}/resumen`);
  await foto(page, "portofino-v7-resumen-despues");
  await foto(page, "portofino-v7-resumen-despues-completo", true);

  // ── La V6, intacta (el antes) ────────────────────────────────────────────
  await irA(page, `/proyectos/${PROYECTO}/presupuesto/${V6}`);
  await foto(page, "portofino-v6-itemizado-antes");

  await browser.close();
  console.log("\nlisto.");
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exitCode = 1;
});
