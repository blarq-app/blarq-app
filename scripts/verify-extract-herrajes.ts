/**
 * Verificación en pantalla del catálogo de herrajes (pendiente 135).
 *
 * SOLO LECTURA: abre el formulario de alta y lo usa, pero NUNCA aprieta
 * "Guardar" — no crea, edita ni borra nada.
 *
 * Prueba dos cosas:
 *   A) El proveedor del formulario de alta cuando MJ cambia de pestaña con el
 *      formulario abierto (bug del pantallazo: decía DPH parada en HBT).
 *   B) El "Extraer" con el link de hbt.cl que le falló: mide cuánto tarda y
 *      muestra si trajo foto, nombre y precio.
 *
 * Uso:
 *   npx tsx scripts/verify-extract-herrajes.ts [baseUrl] [rutaDelEnv]
 *
 *   # local (dev):
 *   npx tsx scripts/verify-extract-herrajes.ts http://localhost:3135
 *   # deploy de preview (el secret de auth tiene que ser el mismo del deploy):
 *   npx tsx scripts/verify-extract-herrajes.ts https://<preview>.vercel.app .env.prod
 */
import { chromium, type Page } from "playwright";
import { readFileSync, mkdirSync } from "fs";
import { hkdf } from "@panva/hkdf";

const BASE = process.argv[2] ?? "http://localhost:3135";
const ENV_FILE = process.argv[3] ?? "/Users/mjblanco/Desktop/blarq-app/.env";
const OUT = "scripts/_capturas";

// El link exacto que le falló a MJ en la app.
const LINK =
  "https://www.hbt.cl/bisagra-cliptop-recta-omnia-95-tornillo-onix-x10.html";

const env = readFileSync(ENV_FILE, "utf8");
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
    .setJti("verificacion")
    .encrypt(key);
}

async function capturar(page: Page, nombre: string) {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${nombre}.png`, fullPage: false });
  console.log(`   captura → ${OUT}/${nombre}.png`);
}

// Lo que se ve del formulario de alta. Inline a propósito: dentro de
// page.evaluate no se pueden declarar funciones con tsx (mete un helper
// `__name` que en el navegador no existe).
async function estadoForm(page: Page) {
  return await page.evaluate(() => ({
    formAbierto: Array.from(document.querySelectorAll("h2")).some((h) =>
      (h.textContent ?? "").includes("Nuevo herraje"),
    ),
    pestana:
      Array.from(document.querySelectorAll("button.bg-gray-900"))
        .map((b) => (b.textContent ?? "").trim())
        .find((t) => /^(DPH|HBT)\s*\d*$/.test(t))
        ?.slice(0, 3) ?? "?",
    proveedor:
      document.querySelectorAll<HTMLSelectElement>("form select")[0]?.value ??
      "?",
    nombre:
      document.querySelector<HTMLInputElement>(
        'input[placeholder="CORREDERA OCULTA"]',
      )?.value ?? "",
    detalle:
      document.querySelector<HTMLInputElement>(
        'input[placeholder="Corredera oculta cierre suave"]',
      )?.value ?? "",
    foto: document.querySelector<HTMLImageElement>("form img")?.src ?? "",
    costo:
      Array.from(document.querySelectorAll<HTMLInputElement>("form input"))
        .map((i) => i.value)
        .join(" | "),
    error:
      document.querySelector("form .bg-amber-50")?.textContent?.trim() ?? "",
  }));
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dominio = new URL(BASE).hostname;
  await ctx.addCookies([
    {
      name: dominio === "localhost" ? "authjs.session-token" : "__Secure-authjs.session-token",
      value: await cookieDeSesion(),
      domain: dominio,
      path: "/",
      httpOnly: true,
      secure: dominio !== "localhost",
    },
  ]);
  const page = await ctx.newPage();

  console.log(`Base: ${BASE}\n`);
  await page.goto(`${BASE}/catalogo/herrajes`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Nuevo herraje", { timeout: 30000 });

  // ---------- A) proveedor vs pestaña ----------
  console.log("A) Proveedor del alta al cambiar de pestaña");
  // El dev server compila al vuelo: el HTML llega antes de que React enganche
  // los handlers, y el primer click se pierde. Reintentamos hasta que abra.
  for (let i = 0; i < 8; i++) {
    await page.getByRole("button", { name: "+ Nuevo herraje" }).click();
    if (await page.locator("form select").first().isVisible().catch(() => false)) break;
    await page.waitForTimeout(1500);
  }
  await page.waitForSelector("form select", { timeout: 10000 });
  const alAbrir = await estadoForm(page);
  console.log(`   abro el alta en la pestaña ${alAbrir.pestana} → PROVEEDOR = ${alAbrir.proveedor}`);

  // Cambio a la otra pestaña con el formulario abierto (lo que hizo MJ).
  const otra = alAbrir.pestana === "DPH" ? "HBT" : "DPH";
  await page.locator("button").filter({ hasText: new RegExp(`^${otra}\\s*\\d`) }).first().click();
  await page.waitForTimeout(500);
  const trasCambiar = await estadoForm(page);
  console.log(
    `   me paro en la pestaña ${trasCambiar.pestana} (form abierto: ${trasCambiar.formAbierto}) → PROVEEDOR = ${trasCambiar.proveedor}`,
  );
  const bugProveedor =
    trasCambiar.formAbierto && trasCambiar.proveedor !== trasCambiar.pestana;
  console.log(
    bugProveedor
      ? `   >>> SE REPRODUCE: parada en ${trasCambiar.pestana} el formulario dice ${trasCambiar.proveedor}.`
      : `   >>> NO se reproduce: el proveedor sigue a la pestaña.`,
  );
  await capturar(page, "135-proveedor-vs-pestana");

  // ---------- B) el Extraer con el link de hbt.cl ----------
  console.log("\nB) Extraer con el link de hbt.cl que le falló");
  await page.locator('input[placeholder="https://…"]').fill(LINK);
  const t0 = Date.now();
  await page.getByRole("button", { name: "Extraer" }).click();
  // Espera a que el botón vuelva de "Buscando…" (o a que aparezca el error).
  await page
    .waitForFunction(
      () =>
        !Array.from(document.querySelectorAll("button")).some(
          (b) => (b.textContent ?? "").trim() === "Buscando…",
        ),
      undefined,
      { timeout: 90000 },
    )
    .catch(() => console.log("   (siguió en 'Buscando…' más de 90 s)"));
  const segs = ((Date.now() - t0) / 1000).toFixed(1);
  const tras = await estadoForm(page);
  console.log(`   tardó ${segs} s`);
  console.log(`   nombre  : ${tras.nombre || "(vacío)"}`);
  console.log(`   detalle : ${tras.detalle || "(vacío)"}`);
  console.log(`   foto    : ${tras.foto ? tras.foto.slice(0, 80) : "(sin foto)"}`);
  console.log(`   campos  : ${tras.costo}`);
  console.log(`   error   : ${tras.error || "(ninguno)"}`);
  console.log(
    tras.error
      ? "   >>> FALLA: el Extraer devolvió error."
      : tras.nombre || tras.foto
        ? "   >>> ANDA: trajo datos del producto."
        : "   >>> raro: sin error pero sin datos.",
  );
  await capturar(page, "135-extract-hbt");

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
