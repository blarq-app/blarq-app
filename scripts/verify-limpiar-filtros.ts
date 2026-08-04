/**
 * Verificación en pantalla del botón "Limpiar" de Banco → Movimientos.
 *
 * SOLO LECTURA: no crea, edita ni borra nada — navega la pantalla como MJ.
 * Corre contra la base dev (ep-solitary-mud); aborta si no lo es.
 *
 * Pasos:
 *   1. Pantalla limpia → el botón NO tiene que estar.
 *   2. Poner filtros a mano (cuenta, estado, respaldo, tipo, búsqueda, monto)
 *      → aparece "Limpiar".
 *   3. Apretar "Limpiar" → URL pelada, cajas vacías, pastillas en su default.
 *   4. Esperar 2s de más: el buscador re-navega 300ms después de cambiar, así
 *      que si quedara texto vivo en la caja volvería a ensuciar la URL.
 *   5. Drill-down por ?id= → el mismo botón, arriba.
 *
 * OJO al verificar: el dev server tarda ~1-2s por navegación con 500 filas, y
 * las navegaciones de Next son client-side (no disparan "load"). Hay que
 * esperar por el CAMBIO DE URL, no por networkidle, o se lee la URL vieja.
 *
 * Uso: npx tsx scripts/verify-limpiar-filtros.ts [baseUrl]
 */
import { chromium, type Page } from "playwright";
import { PrismaClient } from "@prisma/client";
import { readFileSync, mkdirSync } from "fs";
import { hkdf } from "@panva/hkdf";

const BASE = process.argv[2] ?? "http://localhost:3099";
const OUT = "scripts/_capturas";

const env = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const SECRET = env.match(/NEXTAUTH_SECRET\s*=\s*"?([^"\n]+)"?/)![1].trim();
const DB_URL = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });

if (!DB_URL.includes("ep-solitary-mud")) {
  console.error("ABORT: este script es SOLO para la base dev (ep-solitary-mud).");
  process.exit(1);
}

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

const ruta = (page: Page) => page.url().replace(BASE, "");

// Espera a que la URL contenga el param pedido (las navegaciones de Next son
// client-side: no hay evento de carga que esperar).
async function esperarParam(page: Page, fragmento: string) {
  await page.waitForFunction(
    (f) => location.pathname + location.search === f || location.search.includes(f),
    fragmento,
    { timeout: 20000 }
  );
}

async function capturar(page: Page, nombre: string) {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${nombre}.png`, fullPage: false });
  console.log(`   captura → ${OUT}/${nombre}.png`);
}

// Lo que MJ ve en la barra de filtros: pastillas marcadas, texto escrito en las
// dos cajas de búsqueda, y si el botón "Limpiar" está o no.
//
// OJO: adentro de page.evaluate no se pueden declarar funciones (ni siquiera
// una arrow asignada a const): tsx las envuelve con un helper `__name` que en
// el navegador no existe, y el evaluate revienta con "__name is not defined".
// Todo inline.
async function estadoBarra(page: Page) {
  return await page.evaluate(() => ({
    pastillas: Array.from(document.querySelectorAll("a.bg-gray-900"))
      .map((el) => (el.textContent ?? "").trim())
      .filter(Boolean),
    busqueda:
      document.querySelector<HTMLInputElement>(
        'input[placeholder="Buscar descripción, nombre o RUT…"]'
      )?.value ?? "",
    monto:
      document.querySelector<HTMLInputElement>('input[placeholder="Monto exacto…"]')?.value ?? "",
    limpiar: Array.from(document.querySelectorAll("button")).some(
      (b) => (b.textContent ?? "").trim() === "Limpiar"
    ),
    conteo: document.querySelector("h1 + p")?.textContent?.trim() ?? "",
  }));
}

async function main() {
  // Un movimiento real de dev, para que los filtros de texto y monto den
  // resultados de verdad y no una lista vacía.
  // Se elige un egreso conciliado CONTRA FACTURA para que la combinación de
  // filtros de la captura (cuenta + Conciliado + Factura + Egresos + búsqueda +
  // monto) muestre filas de verdad y no una lista vacía: la captura es lo que
  // mira MJ para aprobar (§4.10).
  const mov = await prisma.bankMovement.findFirst({
    where: {
      amount: { lt: 0 },
      status: "conciliado",
      counterpartyName: { not: null },
      payments: { some: { invoice: { origin: { in: ["sii_automatica", "manual"] } } } },
    },
    orderBy: { date: "desc" },
    select: { id: true, description: true, amount: true, counterpartyName: true, bankAccountId: true },
  });
  if (!mov) throw new Error("La base dev no tiene movimientos para probar.");
  const palabra =
    (mov.counterpartyName ?? "").split(/\s+/).find((w) => w.length >= 5) ??
    mov.description.split(/\s+/).find((w) => w.length >= 5) ??
    "trans";
  console.log(`Movimiento de referencia: "${mov.counterpartyName}" ${mov.amount}\n`);

  const browser = await chromium.launch();
  // Cerrar el browser pase lo que pase: si un paso tira excepción y el browser
  // queda abierto, el proceso no termina nunca y parece colgado.
  process.on("exit", () => void browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([
    {
      name: "authjs.session-token",
      value: await cookieDeSesion(),
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errores: string[] = [];

  // ── 1. Pantalla limpia ────────────────────────────────────────────────
  await page.goto(`${BASE}/banco/movimientos`, { waitUntil: "networkidle" });
  const paso1 = await estadoBarra(page);
  console.log("1) Sin filtros:", JSON.stringify(paso1));
  if (paso1.limpiar) errores.push('"Limpiar" aparece con la pantalla ya limpia');
  await capturar(page, "limpiar-filtros-1-sin-filtros");

  // ── 2. Poner filtros ──────────────────────────────────────────────────
  // Cuenta + estado + respaldo + tipo van por URL (es lo mismo que clickear
  // las pastillas, y no depende de que la tabla de 500 filas se quede quieta
  // para que Playwright acepte el click). La búsqueda y el monto SÍ se tipean:
  // esos dos guardan estado propio dentro de la caja, que es justo lo que el
  // botón tiene que dejar limpio.
  const filtros = new URLSearchParams({
    accountId: mov.bankAccountId,
    status: "pagado",
    respaldo: "factura",
    tipo: "egreso",
  });
  await page.goto(`${BASE}/banco/movimientos?${filtros}`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Buscar descripción, nombre o RUT…").fill(palabra);
  await esperarParam(page, "q=");
  await page.getByPlaceholder("Monto exacto…").fill(String(Math.abs(mov.amount)));
  await esperarParam(page, "monto=");
  await page.waitForTimeout(1500); // que asiente el último render

  const paso2 = await estadoBarra(page);
  console.log("\n2) Con filtros:", JSON.stringify(paso2));
  console.log("   URL:", ruta(page));
  if (!paso2.limpiar) errores.push('no aparece el botón "Limpiar" con filtros puestos');
  await capturar(page, "limpiar-filtros-2-con-filtros");

  // ── 3. Apretar "Limpiar" ──────────────────────────────────────────────
  await page.getByRole("button", { name: "Limpiar", exact: true }).click();
  await page.waitForLoadState("networkidle");
  // El buscador re-navega 300ms después de cualquier cambio: si quedara texto
  // vivo en la caja, volvería a poner ?q= en la URL. Esperamos de más a
  // propósito para pescar ese rebote.
  await page.waitForTimeout(2000);

  const paso3 = await estadoBarra(page);
  console.log("\n3) Después de Limpiar:", JSON.stringify(paso3));
  console.log("   URL:", ruta(page));
  await capturar(page, "limpiar-filtros-3-despues");

  if (ruta(page) !== "/banco/movimientos") errores.push(`la URL quedó en "${ruta(page)}"`);
  if (paso3.busqueda) errores.push(`quedó texto en el buscador: "${paso3.busqueda}"`);
  if (paso3.monto) errores.push(`quedó texto en el monto: "${paso3.monto}"`);
  if (paso3.limpiar) errores.push('el botón "Limpiar" sigue a la vista');
  if (JSON.stringify(paso3.pastillas) !== JSON.stringify(paso1.pastillas))
    errores.push(`pastillas activas ${JSON.stringify(paso3.pastillas)} ≠ ${JSON.stringify(paso1.pastillas)}`);
  if (paso3.conteo !== paso1.conteo)
    errores.push(`el conteo quedó en "${paso3.conteo}" y no en "${paso1.conteo}"`);

  // ── 4. Drill-down por ?id= (el "Limpiar" de arriba) ───────────────────
  await page.goto(`${BASE}/banco/movimientos?id=${mov.id}`, { waitUntil: "networkidle" });
  const drill = await estadoBarra(page);
  console.log("\n4) Drill-down por id:", JSON.stringify(drill));
  if (!drill.limpiar) errores.push("en el drill-down por id no hay botón Limpiar");
  await capturar(page, "limpiar-filtros-4-drilldown");
  await page.getByRole("button", { name: "Limpiar", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  console.log("   URL después de limpiar:", ruta(page));
  if (ruta(page) !== "/banco/movimientos") errores.push(`drill-down: la URL quedó en "${ruta(page)}"`);

  await browser.close();

  console.log("\n" + "─".repeat(60));
  if (errores.length) {
    console.error("FALLA:\n - " + errores.join("\n - "));
    process.exitCode = 1;
  } else {
    console.log("OK: limpia todo y deja la pantalla igual que recién entrada.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
