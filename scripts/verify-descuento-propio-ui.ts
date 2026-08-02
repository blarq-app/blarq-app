/**
 * Captura de la columna DCTO con el descuento propio marcado (2026-08-02).
 *
 * Siembra en DEV dos líneas del mismo producto — una con el descuento de la
 * tienda y otra con uno puesto por MJ — y fotografía la fila para que se vea la
 * diferencia. Borra todo al final.
 *
 *   npx tsx scripts/verify-descuento-propio-ui.ts [url]
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

async function cookie(): Promise<string> {
  const { EncryptJWT } = await import("jose");
  const salt = "authjs.session-token";
  const key = await hkdf("sha256", SECRET, salt, `Auth.js Generated Encryption Key (${salt})`, 64);
  return await new EncryptJWT({ name: "MJ Blanco", email: "mjblanco@blarq.cl", sub: "verif" })
    .setProtectedHeader({ alg: "dir", enc: "A256CBC-HS512" })
    .setIssuedAt().setExpirationTime("1h").setJti("verif-dcto").encrypt(key);
}

async function main() {
  if (!/solitary-mud/.test(DB)) throw new Error("Solo dev. Abortado.");
  mkdirSync(OUT, { recursive: true });

  const bv = await prisma.budgetVersion.findFirst({
    where: { type: "artefactos", status: "borrador" },
    select: { id: true, project: { select: { id: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (!bv?.project) throw new Error("No hay cotización de artefactos en borrador.");

  const ids: string[] = [];
  try {
    const comun = {
      budgetVersionId: bv.id, room: "bano_principal", subcategory: "sanitario",
      brand: "KLIPEN", quantity: 1, listPrice: 149390,
      referenceLink: "https://www.mk.cl/gkl030061-mezclador-tina-urban-empotrado-2-vias-cromado-griferias/p",
      priceOverridden: false, catalogId: null as string | null,
    };
    const a = await prisma.artefactoItem.create({
      data: { ...comun, name: "ZZ DCTO DE LA TIENDA", detail: "Mezclador Tina Urban 2 vías cromado",
        discountPercent: 0.36, clientPrice: 95610, discountOverridden: false, sortOrder: 90001 },
    });
    const b = await prisma.artefactoItem.create({
      data: { ...comun, name: "ZZ DCTO PUESTO POR MJ", detail: "Mezclador Tina Urban 2 vías cromado",
        discountPercent: 0.45, clientPrice: 82165, discountOverridden: true, sortOrder: 90002 },
    });
    ids.push(a.id, b.id);

    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
    await ctx.addCookies([{ name: "authjs.session-token", value: await cookie(), domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/proyectos/${bv.project.id}/presupuesto/${bv.id}`, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(2000);

    const fila = page.locator("text=ZZ DCTO DE LA TIENDA").first();
    await fila.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    const caja = await fila.boundingBox();
    await page.screenshot({
      path: `${OUT}/dcto-propio-vs-tienda.png`,
      clip: { x: 40, y: Math.max(0, caja!.y - 42), width: 1420, height: 150 },
    });
    console.log("capturado:", `${OUT}/dcto-propio-vs-tienda.png`);
    await browser.close();
  } finally {
    for (const id of ids) await prisma.artefactoItem.delete({ where: { id } }).catch(() => {});
    console.log("Líneas de prueba borradas.");
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
