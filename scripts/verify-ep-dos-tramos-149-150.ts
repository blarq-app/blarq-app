/**
 * Verificación en pantalla de los pendientes 149 y 150.
 *
 *   149 — barra de avance en DOS TRAMOS (ya pagado / este EP), en pantalla y
 *         en el PDF del maestro.
 *   150 — panorama del maestro en su lista de EPs (partidas, MO total, pagado,
 *         saldo).
 *
 * Corre contra la base de DESARROLLO (ep-solitary-mud), nunca la viva, y ARMA
 * el escenario que hace falta: un EP 1 cerrado + un EP 2 en borrador sobre el
 * mismo maestro. Sin un EP anterior cerrado no hay "ya pagado" que mostrar, así
 * que la barra de dos tramos no se podría ver.
 *
 * Todo se hace por los endpoints REALES de la app (crear, guardar avance,
 * cerrar), no escribiendo la base a mano: así lo que se verifica es el camino
 * que usa MJ.
 *
 * Correr con:  npx tsx scripts/verify-ep-dos-tramos-149-150.ts [url]
 */
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { chromium, type Page, type Locator, type APIRequestContext } from "playwright";
import hkdf from "@panva/hkdf";

const BASE = process.argv[2] ?? "http://localhost:3146";
const OUT = "scripts/_capturas";

// Portofino + "Cuadrilla obra gruesa (demo)" en la base dev: 42 partidas.
const PROYECTO = "cmoj9qhwe0000rtpz4wdb64cn";
const MAESTRO = "cmrlc2cpz0000rtw9wm2yg358";
const URL_MAESTRO = `${BASE}/proyectos/${PROYECTO}/estados-pago/maestro/${MAESTRO}`;

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
    .setJti("verificacion-149-150")
    .encrypt(key);
}

async function foto(target: Page | Locator, nombre: string) {
  mkdirSync(OUT, { recursive: true });
  await target.screenshot({ path: `${OUT}/${nombre}.png` });
  console.log(`   foto → ${OUT}/${nombre}.png`);
}

function fmt(n: number) {
  return "$" + Math.round(n).toLocaleString("es-CL");
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

// Carga avance por el endpoint por partida (el mismo que usa el editor).
async function cargarAvance(api: APIRequestContext, epId: string, itemId: string, qty: number) {
  const r = await api.patch(`${BASE}/api/estados-pago/${epId}/items/${itemId}`, {
    data: { quantityExecuted: qty },
  });
  if (!r.ok()) throw new Error(`avance: ${r.status()} ${await r.text()}`);
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
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

  // Borrar lo que dejó una corrida anterior: si no, cada pasada apila otro par
  // de EPs y la secuencia queda con un borrador metido entre dos cerrados, que
  // no es el caso que se quiere mirar.
  const previos = await (await api.get(`${BASE}/api/proyectos/${PROYECTO}/estados-pago`)).json();
  const aBorrar = (Array.isArray(previos) ? previos : []).filter(
    (e: { maestroId: string | null }) => e.maestroId === MAESTRO
  );
  for (const e of aBorrar) await api.delete(`${BASE}/api/estados-pago/${e.id}`);
  if (aBorrar.length) console.log(`0. Limpiando ${aBorrar.length} EP(s) de una corrida anterior`);

  // ── Escenario: EP 1 con avance, cerrado; EP 2 en borrador ─────────────
  console.log("1. Armando el escenario en dev (EP 1 cerrado + EP 2 borrador)…");
  const ep1 = await crearEp(api);
  const items1 = await itemsDelEp(api, ep1.id);
  console.log(`   EP #${ep1.number} creado — ${items1.length} partidas`);

  // Avance del EP 1: 40% en las primeras 6 partidas con cantidad > 0.
  const conCantidad = items1.filter((i) => i.quantity > 0);
  const objetivo = conCantidad.slice(0, 6);
  for (const it of objetivo) await cargarAvance(api, ep1.id, it.id, it.quantity * 0.4);
  console.log(`   EP #${ep1.number}: 40% en ${objetivo.length} partidas`);

  const cerrar = await api.post(`${BASE}/api/estados-pago/${ep1.id}/close`);
  if (!cerrar.ok()) throw new Error(`cerrar: ${cerrar.status()} ${await cerrar.text()}`);
  console.log(`   EP #${ep1.number} CERRADO`);

  const ep2 = await crearEp(api);
  const items2 = await itemsDelEp(api, ep2.id);
  // Avance del EP 2: sube a 66% en 4 de esas partidas (así hay previo + nuevo),
  // deja 2 sin tocar (previo, sin nuevo) y una partida virgen (sin previo).
  const porLineage = new Map(items2.map((i) => [i.name, i]));
  const subidas = objetivo.slice(0, 4);
  for (const it of subidas) {
    const t = porLineage.get(it.name)!;
    await cargarAvance(api, ep2.id, t.id, t.quantity * 0.66);
  }
  // Una partida SIN previo, para ver que no queda rara con 0% anterior.
  const virgen = items2.find((i) => i.quantity > 0 && !objetivo.some((o) => o.name === i.name))!;
  await cargarAvance(api, ep2.id, virgen.id, virgen.quantity * 0.3);
  console.log(`   EP #${ep2.number}: 4 partidas 40%→66%, 2 quedan en 40%, 1 nueva al 30%`);
  console.log(`   partida sin previo: ${virgen.name}`);

  // ── 149 — la barra en PANTALLA ────────────────────────────────────────
  console.log("\n2. Barra de dos tramos en pantalla…");
  await page.goto(`${BASE}/proyectos/${PROYECTO}/estados-pago/${ep2.id}`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector("text=Total mano de obra");
  const conYaPagado = await page.locator("text=/^ya pagado /").count();
  console.log(`   filas con leyenda "ya pagado": ${conYaPagado} (esperado 6)`);
  const conEsteEp = await page.locator("text=/este EP$/").count();
  console.log(`   filas con "+$X este EP": ${conEsteEp} (esperado 5)`);
  // La barra oscura solo existe donde hay previo.
  const tramosOscuros = await page.locator("div.bg-gray-500[style*='width']").count();
  const tramosClaros = await page.locator("div.bg-gray-300[style*='width']").count();
  console.log(`   tramos oscuros (ya pagado): ${tramosOscuros} · claros (este EP): ${tramosClaros}`);
  await foto(page, "149-1-pantalla-dos-tramos");

  // ── 149 — la barra en el PDF ──────────────────────────────────────────
  console.log("\n3. PDF del maestro, generado de verdad…");
  const pdf = await api.get(`${BASE}/api/estados-pago/${ep2.id}/pdf?variant=maestro`);
  if (!pdf.ok()) throw new Error(`pdf: ${pdf.status()} ${await pdf.text()}`);
  const bytes = await pdf.body();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/149-2-pdf-maestro.pdf`, bytes);
  console.log(`   PDF → ${OUT}/149-2-pdf-maestro.pdf (${Math.round(bytes.length / 1024)} KB)`);

  // ── 150 — panorama del maestro ────────────────────────────────────────
  console.log("\n4. Panorama del maestro…");
  await page.goto(URL_MAESTRO, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Mano de obra total");
  const leer = async (rotulo: string) =>
    (await page.locator(`text=${rotulo}`).first().locator("..").innerText())
      .split("\n")[1]
      .trim();
  const partidas = await leer("Partidas asignadas");
  const moTotal = await leer("Mano de obra total");
  const pagadoTxt = await leer("Pagado");
  const saldoTxt = await leer("Saldo por pagar");
  console.log(`   partidas: ${partidas} | MO total: ${moTotal} | pagado: ${pagadoTxt} | saldo: ${saldoTxt}`);

  // Que cuadre con la tabla de abajo: pagado = suma de los EP CERRADOS.
  const filasEp = await page.locator("tbody tr").all();
  let sumaCerrados = 0;
  for (const f of filasEp) {
    const t = await f.innerText();
    const cols = t.split("\t");
    if (/cerrado/i.test(t)) {
      sumaCerrados += Number(cols[3].replace(/[^0-9]/g, ""));
    }
  }
  const pagadoNum = Number(pagadoTxt.replace(/[^0-9]/g, ""));
  const moNum = Number(moTotal.replace(/[^0-9]/g, ""));
  const saldoNum = Number(saldoTxt.replace(/[^0-9]/g, ""));
  console.log(`   suma "A pagar" de los EP cerrados en la tabla: ${fmt(sumaCerrados)}`);
  const cuadraTabla = pagadoNum === sumaCerrados;
  const cuadraSaldo = moNum - pagadoNum === saldoNum;
  console.log(`   ¿pagado == tabla? ${cuadraTabla ? "SÍ ✔" : "NO ✗"}`);
  console.log(`   ¿MO total − pagado == saldo? ${cuadraSaldo ? "SÍ ✔" : "NO ✗"}`);
  await foto(page, "150-1-panorama-maestro");

  const ok = conYaPagado === 6 && tramosOscuros === 6 && cuadraTabla && cuadraSaldo;
  console.log(`\n${ok ? "TODO OK ✔" : "REVISAR ✗"}`);
  console.log(`\nEP 2 para mirar a mano: ${BASE}/proyectos/${PROYECTO}/estados-pago/${ep2.id}`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
