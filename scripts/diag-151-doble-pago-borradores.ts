/**
 * ¿Se puede pagar dos veces el mismo avance? — comprobación con plata concreta.
 *
 * Pregunta de MJ al ver la inconsistencia del "A pagar": ¿puede llevarnos a un
 * error de PAGOS? Esto lo prueba sobre UNA sola partida, en la base de
 * DESARROLLO, por los endpoints reales de la app.
 *
 * Se comparan dos secuencias:
 *   A) la normal — EP 1 cerrado, después EP 2. Nunca hay dos borradores juntos.
 *   B) la de riesgo — se crea el EP 3 mientras el EP 2 sigue en borrador, y
 *      después se cierran los dos.
 *
 * Correr con:  npx tsx scripts/diag-151-doble-pago-borradores.ts [url]
 */
import { readFileSync } from "fs";
import { chromium, type APIRequestContext } from "playwright";
import hkdf from "@panva/hkdf";

const BASE = process.argv[2] ?? "http://localhost:3146";
const PROYECTO = "cmoj9qhwe0000rtpz4wdb64cn";
const MAESTRO = "cmrlc2cpz0000rtw9wm2yg358";

const env = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const SECRET = env.match(/NEXTAUTH_SECRET\s*=\s*"?([^"\n]+)"?/)![1].trim();

async function cookie(): Promise<string> {
  const { EncryptJWT } = await import("jose");
  const salt = "authjs.session-token";
  const key = await hkdf("sha256", SECRET, salt, `Auth.js Generated Encryption Key (${salt})`, 64);
  return await new EncryptJWT({ name: "MJ Blanco", email: "mjblanco@blarq.cl", sub: "verificacion" })
    .setProtectedHeader({ alg: "dir", enc: "A256CBC-HS512" })
    .setIssuedAt().setExpirationTime("1h").setJti("diag-151").encrypt(key);
}

const fmt = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function crear(api: APIRequestContext) {
  const r = await api.post(`${BASE}/api/proyectos/${PROYECTO}/estados-pago`, {
    data: { maestroId: MAESTRO },
  });
  if (!r.ok()) throw new Error(`crear: ${r.status()} ${await r.text()}`);
  return (await r.json()) as { id: string; number: number };
}
async function items(api: APIRequestContext, epId: string) {
  return (await (await api.get(`${BASE}/api/estados-pago/${epId}`)).json()).items as {
    id: string; name: string; quantity: number; laborUnitPrice: number;
    quantityExecuted: number; amountPaid: number | null;
  }[];
}
async function avance(api: APIRequestContext, epId: string, itemId: string, qty: number) {
  const r = await api.patch(`${BASE}/api/estados-pago/${epId}/items/${itemId}`, {
    data: { quantityExecuted: qty },
  });
  if (!r.ok()) throw new Error(`avance: ${r.status()} ${await r.text()}`);
}
async function cerrar(api: APIRequestContext, epId: string) {
  const r = await api.post(`${BASE}/api/estados-pago/${epId}/close`);
  if (!r.ok()) throw new Error(`cerrar: ${r.status()} ${await r.text()}`);
}
async function limpiar(api: APIRequestContext) {
  const prev = await (await api.get(`${BASE}/api/proyectos/${PROYECTO}/estados-pago`)).json();
  for (const e of (Array.isArray(prev) ? prev : []).filter((x: {maestroId: string|null}) => x.maestroId === MAESTRO)) {
    await api.delete(`${BASE}/api/estados-pago/${e.id}`);
  }
}
// Lo que quedó pagado de UNA partida, sumando todos los EPs cerrados.
async function pagadoDeLaPartida(api: APIRequestContext, nombre: string) {
  const eps = await (await api.get(`${BASE}/api/proyectos/${PROYECTO}/estados-pago`)).json();
  let total = 0;
  const detalle: string[] = [];
  for (const e of eps.filter((x: {maestroId: string|null}) => x.maestroId === MAESTRO)) {
    const its = await items(api, e.id);
    const it = its.find((i) => i.name === nombre);
    if (!it) continue;
    const estado = (await (await api.get(`${BASE}/api/estados-pago/${e.id}`)).json()).status;
    if (estado === "cerrado") {
      total += it.amountPaid ?? 0;
      detalle.push(`EP#${e.number} (cerrado): ${fmt(it.amountPaid ?? 0)}`);
    } else {
      detalle.push(`EP#${e.number} (borrador): —`);
    }
  }
  return { total, detalle };
}

async function main() {
  const b = await chromium.launch();
  const ctx = await b.newContext();
  await ctx.addCookies([{ name: "authjs.session-token", value: await cookie(), domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  const api = ctx.request;

  // ── SECUENCIA A — la normal ───────────────────────────────────────────
  console.log("SECUENCIA A — la normal (se cierra el EP 1 antes de crear el 2)\n");
  await limpiar(api);
  const a1 = await crear(api);
  const itsA = await items(api, a1.id);
  const p = itsA.find((i) => i.quantity > 0)!;
  const MO = p.quantity * p.laborUnitPrice;
  console.log(`Partida de prueba: ${p.name}`);
  console.log(`  cantidad ${p.quantity} × ${fmt(p.laborUnitPrice)} = ${fmt(MO)} de mano de obra total\n`);

  await avance(api, a1.id, p.id, p.quantity * 0.4);
  await cerrar(api, a1.id);
  console.log(`  EP#1: avance al 40% → CERRADO`);
  const a2 = await crear(api);
  const pa2 = (await items(api, a2.id)).find((i) => i.name === p.name)!;
  await avance(api, a2.id, pa2.id, p.quantity * 0.66);
  await cerrar(api, a2.id);
  console.log(`  EP#2: avance al 66% → CERRADO`);
  const resA = await pagadoDeLaPartida(api, p.name);
  resA.detalle.forEach((d) => console.log(`    ${d}`));
  console.log(`  TOTAL PAGADO: ${fmt(resA.total)}  ·  obra ejecutada: 66% = ${fmt(MO * 0.66)}`);
  console.log(`  ${Math.abs(resA.total - MO * 0.66) < 1 ? "CUADRA ✔" : "NO CUADRA ✗"}\n`);

  // ── SECUENCIA B — la de riesgo ────────────────────────────────────────
  console.log("SECUENCIA B — se crea un EP nuevo con el anterior TODAVÍA en borrador\n");
  await limpiar(api);
  const b1 = await crear(api);
  const pb1 = (await items(api, b1.id)).find((i) => i.name === p.name)!;
  await avance(api, b1.id, pb1.id, p.quantity * 0.4);
  await cerrar(api, b1.id);
  console.log(`  EP#1: avance al 40% → CERRADO`);

  const b2 = await crear(api);
  const pb2 = (await items(api, b2.id)).find((i) => i.name === p.name)!;
  await avance(api, b2.id, pb2.id, p.quantity * 0.66);
  console.log(`  EP#2: avance al 66% → queda EN BORRADOR (no se cierra)`);

  const b3 = await crear(api);
  const pb3 = (await items(api, b3.id)).find((i) => i.name === p.name)!;
  console.log(`  EP#3: se crea con el EP#2 abierto → hereda ${((pb3.quantityExecuted / p.quantity) * 100).toFixed(0)}% (del último CERRADO, no del borrador)`);
  await avance(api, b3.id, pb3.id, p.quantity * 0.66);
  await cerrar(api, b3.id);
  console.log(`  EP#3: avance al 66% → CERRADO`);
  await cerrar(api, b2.id);
  console.log(`  EP#2: se cierra después`);

  const resB = await pagadoDeLaPartida(api, p.name);
  resB.detalle.forEach((d) => console.log(`    ${d}`));
  console.log(`  TOTAL PAGADO: ${fmt(resB.total)}  ·  obra ejecutada: 66% = ${fmt(MO * 0.66)}`);
  const demas = resB.total - MO * 0.66;
  console.log(`  ${Math.abs(demas) < 1 ? "CUADRA ✔" : `SE PAGÓ DE MÁS: ${fmt(demas)} ✗`}`);

  await limpiar(api);
  console.log("\n(base dev limpia)");
  await b.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
