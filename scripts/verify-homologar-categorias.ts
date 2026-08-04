/**
 * Antes/después en pantalla de la homologación de categorías del catálogo.
 *
 * Como dev ya quedó migrado, el script primero DEVUELVE dev a los nombres
 * viejos, fotografía, vuelve a homologar y fotografía otra vez. Así el par de
 * capturas sale de la misma pantalla y es comparable.
 *
 * Fotografía dos lugares:
 *   1. Catálogo de Partidas → los títulos de categoría (es lo que cambia).
 *   2. Editor de presupuesto → las sugerencias del botón "+ Capítulo", que
 *      ahora salen de la misma lista.
 *
 * SOLO DESARROLLO. Aborta si el host es el de la viva.
 *
 * Correr:  npx tsx scripts/verify-homologar-categorias.ts [url]
 */
import "dotenv/config";
import { readFileSync, mkdirSync } from "fs";
import { chromium, type Page } from "playwright";
import hkdf from "@panva/hkdf";
import { PrismaClient } from "@prisma/client";

const BASE = process.argv[2] ?? "http://localhost:3061";
const OUT = "scripts/_capturas";
const prisma = new PrismaClient();

const env = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const SECRET = env.match(/NEXTAUTH_SECRET\s*=\s*"?([^"\n]+)"?/)![1].trim();

// nuevo → viejo, para poder volver atrás y sacar la foto del "antes".
// SANITARIAS Y GASFITERIA junta lo que antes eran SANITARIAS y GAS; para el
// antes se devuelve todo a SANITARIAS (el "3 partidas de gas" no cambia la
// idea de la captura, que es cómo se llaman los títulos).
const ATRAS: Array<[string, string]> = [
  ["INSTALACIONES ELECTRICAS", "INSTALACIONES ELECT."],
  ["INSTALACIONES SANITARIAS Y GASFITERIA", "INSTALACIONES SANITARIAS"],
  ["LIMPIEZA Y ASEO", "ASEO Y LIMPIEZA"],
];
const ADELANTE: Array<[string, string]> = [
  ["INSTALACIONES ELECT.", "INSTALACIONES ELECTRICAS"],
  ["INSTALACIONES SANITARIAS", "INSTALACIONES SANITARIAS Y GASFITERIA"],
  ["ASEO Y LIMPIEZA", "LIMPIEZA Y ASEO"],
];

async function mover(pares: Array<[string, string]>) {
  for (const [de, a] of pares) {
    await prisma.partidaCatalog.updateMany({
      where: { category: de },
      data: { category: a },
    });
  }
}

async function cookieDeSesion(): Promise<string> {
  const { EncryptJWT } = await import("jose");
  const salt = "authjs.session-token";
  const key = await hkdf("sha256", SECRET, salt, `Auth.js Generated Encryption Key (${salt})`, 64);
  return await new EncryptJWT({ name: "MJ Blanco", email: "mjblanco@blarq.cl", sub: "verificacion" })
    .setProtectedHeader({ alg: "dir", enc: "A256CBC-HS512" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .setJti("verificacion-homologar")
    .encrypt(key);
}

async function capturar(page: Page, nombre: string, selector?: string) {
  mkdirSync(OUT, { recursive: true });
  const ruta = `${OUT}/${nombre}.png`;
  if (selector) await page.locator(selector).first().screenshot({ path: ruta });
  else await page.screenshot({ path: ruta });
  console.log("  capturado:", ruta);
}

// Deja SOLO los títulos de categoría a la vista: el catálogo abierto es larguísimo
// y en una captura entera los títulos quedan perdidos entre cientos de partidas.
async function soloTitulos(page: Page) {
  // Cada categoría es un bloque cuyo PRIMER hijo es la barra gris con el
  // nombre; el resto son las partidas. Se ocultan los hermanos y quedan las
  // barras apiladas, que es exactamente lo que cambia.
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('div[class*="DBDBDB"]').forEach((barra) => {
      const grupo = barra.parentElement;
      if (!grupo) return;
      [...grupo.children].forEach((hijo) => {
        if (hijo !== barra) (hijo as HTMLElement).style.display = "none";
      });
    });
  });
}

async function fotoCatalogo(page: Page, nombre: string) {
  await page.goto(`${BASE}/catalogo/partidas`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await soloTitulos(page);
  await page.waitForTimeout(300);
  await capturar(page, nombre, "main");
  const titulos = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('div[class*="DBDBDB"]')].map((b) =>
      (b.textContent ?? "").trim().replace(/\s+/g, " ")
    )
  );
  console.log("  categorías en pantalla:", titulos.length);
  for (const t of titulos) console.log("     ", t.replace(/\s+/g, " "));
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/:]+)/)?.[1] ?? "?";
  console.log("Base:", host);
  if (host.includes("shy-morning")) throw new Error("ABORTA: esta verificación escribe; solo dev.");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
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

  try {
    console.log("\nANTES — categorías con los nombres viejos");
    await mover(ATRAS);
    await fotoCatalogo(page, "hom-01-catalogo-antes");

    console.log("\nDESPUÉS — homologadas con los nombres de los capítulos");
    await mover(ADELANTE);
    await fotoCatalogo(page, "hom-02-catalogo-despues");

    // Sugerencias del botón "+ Capítulo": ahora salen de la misma lista.
    const bv = await prisma.budgetVersion.findFirst({
      where: { status: "borrador", obraChapters: { some: {} } },
      select: { id: true, projectId: true },
    });
    if (bv) {
      await page.goto(`${BASE}/proyectos/${bv.projectId}/presupuesto/${bv.id}`, {
        waitUntil: "networkidle",
      });
      await page.waitForTimeout(1500);
      const btn = page.getByRole("button", { name: /\+ Cap[ií]tulo/i }).first();
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      await page.waitForTimeout(1200);
      await capturar(page, "hom-03-sugerencias-capitulo");
    }
  } finally {
    // Dev queda homologado, que es el estado bueno.
    await mover(ADELANTE);
    const cats = await prisma.partidaCatalog.findMany({ select: { category: true } });
    console.log(
      "\nEstado final de dev:",
      [...new Set(cats.map((c) => c.category))].sort().join(" | ")
    );
    await browser.close();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
