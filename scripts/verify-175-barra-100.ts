/**
 * Pendiente 175 — la barra de avance va de UN SOLO TONO (el desglose lo cuenta
 * el texto).
 *
 * Corre contra la base de DESARROLLO (ep-solitary-mud), nunca la viva, y ARMA
 * el escenario que hace falta: un EP 1 cerrado con avance parcial + un EP 2 en
 * borrador donde algunas partidas llegan al 100% (esas son las que salían
 * partidas en dos tonos casi iguales) y otras quedan a medias, para que en la
 * misma pantalla se vean los dos casos.
 *
 * Todo por los endpoints REALES de la app (crear, guardar avance, cerrar), no
 * escribiendo la base a mano.
 *
 * Correr con:  npx tsx scripts/verify-175-barra-100.ts [url]
 */
import { readFileSync, mkdirSync } from "fs";
import { chromium, type Page, type Locator, type APIRequestContext } from "playwright";
import hkdf from "@panva/hkdf";

const BASE = process.argv[2] ?? "http://localhost:3175";
const OUT = "scripts/_capturas";
const SUFIJO = process.env.SUFIJO ?? "despues";

// Portofino + "Cuadrilla obra gruesa (demo)" en la base dev: 42 partidas.
const PROYECTO = "cmoj9qhwe0000rtpz4wdb64cn";
const MAESTRO = "cmrlc2cpz0000rtw9wm2yg358";

const env = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const SECRET = env.match(/NEXTAUTH_SECRET\s*=\s*"?([^"\n]+)"?/)![1].trim();

async function cookieDeSesion(): Promise<string> {
  const { EncryptJWT } = await import("jose");
  const salt = "authjs.session-token";
  const key = await hkdf("sha256", SECRET, salt, `Auth.js Generated Encryption Key (${salt})`, 64);
  return await new EncryptJWT({ name: "MJ Blanco", email: "mjblanco@blarq.cl", sub: "verificacion" })
    .setProtectedHeader({ alg: "dir", enc: "A256CBC-HS512" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .setJti("verificacion-175")
    .encrypt(key);
}

async function foto(target: Page | Locator, nombre: string) {
  mkdirSync(OUT, { recursive: true });
  await target.screenshot({ path: `${OUT}/${nombre}.png` });
  console.log(`   foto → ${OUT}/${nombre}.png`);
}

async function crearEp(api: APIRequestContext) {
  const r = await api.post(`${BASE}/api/proyectos/${PROYECTO}/estados-pago`, {
    data: { maestroId: MAESTRO },
  });
  if (!r.ok()) throw new Error(`crear EP: ${r.status()} ${await r.text()}`);
  return (await r.json()) as { id: string; number: number };
}

async function itemsDelEp(api: APIRequestContext, epId: string) {
  const r = await api.get(`${BASE}/api/estados-pago/${epId}`);
  const j = await r.json();
  return j.items as {
    id: string;
    name: string;
    quantity: number;
    laborUnitPrice: number;
    quantityExecuted: number;
  }[];
}

async function cargarAvance(api: APIRequestContext, epId: string, itemId: string, qty: number) {
  const r = await api.patch(`${BASE}/api/estados-pago/${epId}/items/${itemId}`, {
    data: { quantityExecuted: qty },
  });
  if (!r.ok()) throw new Error(`avance: ${r.status()} ${await r.text()}`);
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1100 },
    deviceScaleFactor: 2,
  });
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
  const api = ctx.request;

  // Limpiar lo que dejó una corrida anterior: si no, cada pasada apila otro par
  // de EPs y la secuencia queda con un borrador metido entre dos cerrados.
  const previos = await (await api.get(`${BASE}/api/proyectos/${PROYECTO}/estados-pago`)).json();
  const aBorrar = (Array.isArray(previos) ? previos : []).filter(
    (e: { maestroId: string | null }) => e.maestroId === MAESTRO
  );
  for (const e of aBorrar) await api.delete(`${BASE}/api/estados-pago/${e.id}`);
  if (aBorrar.length) console.log(`0. Limpiando ${aBorrar.length} EP(s) de una corrida anterior`);

  console.log("1. Armando el escenario en dev (EP 1 cerrado + EP 2 borrador)…");
  const ep1 = await crearEp(api);
  const items1 = await itemsDelEp(api, ep1.id);
  const conCantidad = items1.filter((i) => i.quantity > 0);
  // EP 1: 60% en 6 partidas. Cuatro de ellas suben en el EP 2, dos quedan ahí.
  const objetivo = conCantidad.slice(0, 6);
  for (const it of objetivo) await cargarAvance(api, ep1.id, it.id, it.quantity * 0.6);
  const cerrar = await api.post(`${BASE}/api/estados-pago/${ep1.id}/close`);
  if (!cerrar.ok()) throw new Error(`cerrar: ${cerrar.status()} ${await cerrar.text()}`);
  console.log(`   EP #${ep1.number}: 60% en ${objetivo.length} partidas, CERRADO`);

  const ep2 = await crearEp(api);
  const items2 = await itemsDelEp(api, ep2.id);
  const porNombre = new Map(items2.map((i) => [i.name, i]));

  // El caso del pendiente: 3 partidas con previo que llegan al 100% (antes se
  // dibujaban en dos tramos casi iguales y parecían a medio pagar).
  for (const it of objetivo.slice(0, 3)) {
    const t = porNombre.get(it.name)!;
    await cargarAvance(api, ep2.id, t.id, t.quantity);
  }
  // Una con previo que queda a medias: tiene que seguir en DOS tramos.
  const media = porNombre.get(objetivo[3].name)!;
  await cargarAvance(api, ep2.id, media.id, media.quantity * 0.85);
  // Una SIN previo que llega al 100% en este EP (el caso "EP 1": antes salía de
  // un solo tramo pero del tono CLARO, casi igual al riel vacío).
  const virgen = items2.find(
    (i) => i.quantity > 0 && !objetivo.some((o) => o.name === i.name)
  )!;
  await cargarAvance(api, ep2.id, virgen.id, virgen.quantity);
  console.log(`   EP #${ep2.number}: 3 partidas 60%→100%, 1 al 85%, 1 nueva al 100%`);
  console.log(`   sin previo al 100%: ${virgen.name}`);

  console.log("\n2. Pantalla del editor…");
  await page.goto(`${BASE}/proyectos/${PROYECTO}/estados-pago/${ep2.id}`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector("text=Total mano de obra");

  // Todas las barras tienen que ser del MISMO tono: un solo div oscuro con su
  // ancho. Si aparece alguno claro, volvieron los dos tramos.
  const barras = await page.locator("div.bg-gray-500[style*='width']").count();
  const tramosClaros = await page.locator("div.bg-gray-300[style*='width']").count();
  console.log(`   barras (un solo tono): ${barras}`);
  console.log(`   tramos claros que quedaron: ${tramosClaros} (tiene que ser 0)`);

  await foto(page, `175-pantalla-${SUFIJO}`);

  // El recorte ampliado de la columna AVANCE se hace después sobre el PNG
  // (con sips): la barra mide pocos píxeles y en la foto entera no se aprecia.
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
