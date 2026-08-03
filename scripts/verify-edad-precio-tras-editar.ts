/**
 * El caso que reportó MJ (2026-08-03): actualizó un producto del catálogo y la
 * fila siguió diciendo "revisado hace más de un mes" en ámbar, aunque el precio
 * había quedado bien guardado. El dato estaba bien; la pantalla mostraba el
 * valor viejo porque el cliente no leía lo que devuelve el servidor.
 *
 * Siembra un producto con la última revisión vieja, lo edita DESDE LA PANTALLA
 * (como lo hace MJ) y comprueba que el aviso pasa a "revisado hoy" sin recargar.
 * Corre contra DEV y borra lo sembrado.
 *
 *   npx tsx scripts/verify-edad-precio-tras-editar.ts [url]
 */
import "dotenv/config";
import { readFileSync, mkdirSync } from "fs";
import { chromium } from "playwright";
import hkdf from "@panva/hkdf";
import { PrismaClient } from "@prisma/client";

const BASE = process.argv[2] ?? "http://localhost:3157";
const OUT = "docs/auditoria-artefactos-precios-2026-07-assets";
const env = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const SECRET = env.match(/NEXTAUTH_SECRET\s*=\s*"?([^"\n]+)"?/)![1].trim();
const DB = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const prisma = new PrismaClient({ datasources: { db: { url: DB } } });

const MARCA = "ZZEDAD";

async function cookie(): Promise<string> {
  const { EncryptJWT } = await import("jose");
  const salt = "authjs.session-token";
  const key = await hkdf("sha256", SECRET, salt, `Auth.js Generated Encryption Key (${salt})`, 64);
  return await new EncryptJWT({ name: "MJ Blanco", email: "mjblanco@blarq.cl", sub: "verif" })
    .setProtectedHeader({ alg: "dir", enc: "A256CBC-HS512" })
    .setIssuedAt().setExpirationTime("1h").setJti("verif-edad").encrypt(key);
}

async function main() {
  if (!/solitary-mud/.test(DB)) throw new Error("Solo dev. Abortado.");
  mkdirSync(OUT, { recursive: true });

  // Revisado hace 60 días: la fila tiene que nacer en ámbar.
  const viejo = new Date(Date.now() - 60 * 86400000);
  const cat = await prisma.artefactoCatalog.create({
    data: {
      name: `${MARCA} PORTARROLLO ATLAS`, subcategory: "sanitario",
      detail: "Portarrollos Atlas S/Tapa Brushed Nickel", brand: "Klipen",
      listPrice: 30790, discountPercent: 0.35, lastPriceCheck: viejo,
      referenceLink: "https://www.mk.cl/acc080326-portarrollos-atlas-stapa-brushed-nickel-accesorios/p",
    },
  });

  try {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 2 });
    await ctx.addCookies([{ name: "authjs.session-token", value: await cookie(), domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/catalogo/artefactos`, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(1500);
    await page.getByPlaceholder(/Buscar/i).fill(MARCA);
    await page.waitForTimeout(1500);

    const antes = await page.locator("text=/revisado hace/").first().innerText().catch(() => "(no se vio)");
    console.log("Antes de tocar nada:", antes.replace(/\n/g, " "));

    // Como lo hace MJ: Editar → cambiar el precio → Guardar.
    await page.getByRole("button", { name: "Editar" }).first().click();
    await page.waitForTimeout(800);
    const inputPrecio = page.locator('input[value="30790"], input[value="30.790"]').first();
    if (await inputPrecio.count()) {
      await inputPrecio.fill("31790");
    }
    const esperaPut = page.waitForResponse(
      (r) => r.request().method() === "PUT" && /\/api\/catalogo\/artefactos\//.test(r.url()),
      { timeout: 30000 }
    );
    await page.getByRole("button", { name: /Guardar cambios/i }).click();
    const put = await esperaPut;
    console.log(`   (PUT respondió ${put.status()})`);
    await page.waitForTimeout(1500);

    const despues = await page.locator("text=/revisado/").first().innerText().catch(() => "(no se vio)");
    console.log("Después de guardar:  ", despues.replace(/\n/g, " "));

    const ok = /hoy/i.test(despues);
    console.log(ok
      ? "\\nOK — el aviso se actualizó solo, sin recargar la página."
      : "\\nFALLA — sigue mostrando el valor viejo.");

    const caja = await page.locator("main").first().boundingBox();
    await page.screenshot({
      path: `${OUT}/edad-precio-tras-editar.png`,
      clip: { x: caja!.x, y: caja!.y + 295, width: caja!.width, height: 150 },
    });
    console.log("Captura:", `${OUT}/edad-precio-tras-editar.png`);
    await browser.close();
    if (!ok) process.exitCode = 1;
  } finally {
    await prisma.artefactoCatalog.delete({ where: { id: cat.id } }).catch(() => {});
    console.log("Producto de prueba borrado.");
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
