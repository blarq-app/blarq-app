/**
 * Verificación e2e de la fuente única del status de movimientos + rótulo nuevo.
 *
 * Reproduce el caso SODIMAC en dev con un movimiento y una factura DE PRUEBA
 * (se crean acá y se borran al final — no toca datos reales):
 *
 *   1. Nace el movimiento → chip "Sin imputar" (rótulo nuevo).
 *   2. Conciliar contra la factura → "Imputado".
 *   3. Desasignar (bulk) → vuelve a "Sin imputar".
 *   4. Re-conciliar y BORRAR la factura → el movimiento cae a "Sin imputar".
 *      (Este es el agujero viejo: los pagos se iban en cascada y el movimiento
 *      quedaba "Pagado" fantasma para siempre.)
 *
 * Cada paso deja captura en scripts/_capturas/ para mostrárselas a MJ.
 * Los cambios de estado se hacen por los MISMOS endpoints que usa la UI
 * (PATCH movimiento, POST bulk, DELETE factura), autenticados con cookie
 * firmada; la pantalla se captura recargada después de cada paso.
 *
 * Uso: npx tsx scripts/verify-estado-movimientos.ts [baseUrl]
 */
import { chromium, type Page } from "playwright";
import { PrismaClient } from "@prisma/client";
import { readFileSync, mkdirSync } from "fs";
import { hkdf } from "@panva/hkdf";

const BASE = process.argv[2] ?? "http://localhost:3095";
const OUT = "scripts/_capturas";
const MARCA = "PRUEBA ESTADO SODIMAC";

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

async function limpiar() {
  // Borrar restos de corridas anteriores (pagos caen en cascada).
  await prisma.invoice.deleteMany({ where: { businessName: MARCA } });
  await prisma.bankMovement.deleteMany({ where: { description: { contains: MARCA } } });
}

async function capturar(page: Page, nombre: string) {
  mkdirSync(OUT, { recursive: true });
  const url = `${BASE}/banco/movimientos?q=${encodeURIComponent(MARCA)}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${OUT}/${nombre}.png`, fullPage: false });
  console.log(`  captura: ${OUT}/${nombre}.png`);
}

async function estadoEnBase(movId: string): Promise<string> {
  const m = await prisma.bankMovement.findUnique({ where: { id: movId }, select: { status: true } });
  return m?.status ?? "(borrado)";
}

function check(nombre: string, got: string, want: string) {
  const ok = got === want;
  console.log(`${ok ? "OK " : "FALLA"}  ${nombre}: status=${got}${ok ? "" : ` (esperaba ${want})`}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  await limpiar();

  // ── Datos de prueba ──────────────────────────────────────────────────────
  const cuenta = await prisma.bankAccount.findFirst({ select: { id: true } });
  if (!cuenta) throw new Error("No hay cuenta bancaria en dev");

  const mov = await prisma.bankMovement.create({
    data: {
      bankAccountId: cuenta.id,
      date: new Date("2026-07-20"),
      description: `TRANSFERENCIA ${MARCA}`,
      amount: -188000,
      type: "egreso",
      counterpartyName: MARCA,
      counterpartyRut: "96792430-K",
      status: "sin_asignar",
    },
  });
  const inv = await prisma.invoice.create({
    data: {
      type: "recibida",
      tipoDoc: 33,
      folioNumber: "PRUEBA-EST-1",
      rutIssuer: "96792430-K",
      rutReceiver: "77270733-9",
      businessName: MARCA,
      issueDate: new Date("2026-07-18"),
      dueDate: new Date("2026-08-18"),
      netAmount: 157983,
      iva: 30017,
      totalAmount: 188000,
      status: "pendiente",
      origin: "manual",
    },
  });

  const token = await cookieDeSesion();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 700 } });
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

  // 1. Nace sin imputar.
  check("1. nace", await estadoEnBase(mov.id), "sin_asignar");
  await capturar(page, "estado-1-nace-sin-imputar");

  // 2. Conciliar contra la factura (mismo endpoint que el modal).
  let r = await page.request.patch(`${BASE}/api/banco/movimientos/${mov.id}`, {
    data: { invoiceId: inv.id },
  });
  if (!r.ok()) throw new Error(`PATCH conciliar: ${r.status()} ${await r.text()}`);
  check("2. conciliado", await estadoEnBase(mov.id), "conciliado");
  await capturar(page, "estado-2-imputado");

  // 3. Desasignar masivo → vuelve a la cola.
  r = await page.request.post(`${BASE}/api/banco/movimientos/bulk`, {
    data: { action: "desasignar", movementIds: [mov.id] },
  });
  if (!r.ok()) throw new Error(`POST desasignar: ${r.status()} ${await r.text()}`);
  check("3. desasignado", await estadoEnBase(mov.id), "sin_asignar");
  await capturar(page, "estado-3-desasignado");

  // 4. Re-conciliar y borrar la factura — el agujero SODIMAC.
  r = await page.request.patch(`${BASE}/api/banco/movimientos/${mov.id}`, {
    data: { invoiceId: inv.id },
  });
  if (!r.ok()) throw new Error(`PATCH re-conciliar: ${r.status()} ${await r.text()}`);
  check("4a. re-conciliado", await estadoEnBase(mov.id), "conciliado");
  r = await page.request.delete(`${BASE}/api/facturas/${inv.id}`);
  if (!r.ok()) throw new Error(`DELETE factura: ${r.status()} ${await r.text()}`);
  check("4b. factura borrada → mov vuelve a la cola", await estadoEnBase(mov.id), "sin_asignar");
  await capturar(page, "estado-4-factura-borrada-sin-fantasma");

  await browser.close();

  // ── Limpieza total ───────────────────────────────────────────────────────
  await limpiar();
  const restos = await prisma.bankMovement.count({ where: { description: { contains: MARCA } } });
  console.log(`limpieza: ${restos} restos (debe ser 0)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
