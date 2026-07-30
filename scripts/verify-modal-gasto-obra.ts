/**
 * Captura del modal "Pago a obra sin factura" (GastoObraModal) abierto desde la
 * barra de selección, para verificar que queda centrado en la pantalla y que su
 * pie —Cancelar / Registrar— se ve completo.
 *
 * La base dev no tiene egresos, así que el script CREA un movimiento de egreso
 * de prueba, lo usa, y lo borra al final. Solo corre contra la base dev
 * (ep-solitary-mud); aborta si apunta a otra.
 *
 * Uso: npx tsx scripts/verify-modal-gasto-obra.ts <nombre> [baseUrl]
 */
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { readFileSync, mkdirSync } from "fs";
import { hkdf } from "@panva/hkdf";

const NOMBRE = process.argv[2] ?? "gasto-obra";
const BASE = process.argv[3] ?? "http://localhost:3050";
const OUT = "scripts/_capturas";
const MARCA = "PRUEBA MODAL GASTO OBRA";

const env = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const SECRET = env.match(/NEXTAUTH_SECRET\s*=\s*"?([^"\n]+)"?/)![1].trim();
const DB_URL = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();

if (!DB_URL.includes("ep-solitary-mud")) {
  console.error("ABORT: este script es SOLO para la base dev (ep-solitary-mud).");
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });

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

async function main() {
  mkdirSync(OUT, { recursive: true });
  await prisma.bankMovement.deleteMany({ where: { description: { contains: MARCA } } });

  const cuenta = await prisma.bankAccount.findFirst({ select: { id: true } });
  if (!cuenta) throw new Error("No hay cuenta bancaria en dev");
  const mov = await prisma.bankMovement.create({
    data: {
      bankAccountId: cuenta.id,
      date: new Date("2026-07-20"),
      description: `TRANSFERENCIA ${MARCA}`,
      amount: -350000,
      type: "egreso",
      counterpartyName: MARCA,
      status: "sin_asignar",
    },
  });

  try {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
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
    await page.goto(`${BASE}/banco/movimientos?q=${encodeURIComponent(MARCA)}`, {
      waitUntil: "networkidle",
    });

    const check = page.locator('input[aria-label="Seleccionar movimiento"]').first();
    await check.waitFor({ timeout: 30000 });
    await check.check();

    await page
      .locator("div.fixed.bottom-4")
      .getByRole("button", { name: /Resolver/ })
      .click();
    await page.waitForTimeout(600);
    await page.getByText(/Pago a obra sin factura/).first().click();
    await page.waitForTimeout(1200);

    // Geometría: el fondo oscuro tiene que medir la pantalla completa y el pie
    // del modal tiene que quedar por encima del borde inferior de la ventana.
    const info = await page.evaluate(`(() => {
      const h2 = [...document.querySelectorAll("h2")].find(e => /sin factura|Registrar gasto/i.test(e.textContent));
      const caja = h2.closest("div.bg-white");
      const overlay = caja.parentElement;
      const rect = (e) => { const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }; };
      return { viewport: window.innerHeight, overlay: rect(overlay), modal: rect(caja) };
    })()`);
    console.log(JSON.stringify(info));

    await page.screenshot({ path: `${OUT}/${NOMBRE}.png` });
    console.log(`captura: ${OUT}/${NOMBRE}.png`);
    await browser.close();
  } finally {
    // El movimiento de prueba se borra siempre, aunque la captura falle.
    await prisma.bankMovement.delete({ where: { id: mov.id } }).catch(() => {});
    await prisma.$disconnect();
  }
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
