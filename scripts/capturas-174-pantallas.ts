// Pantallazos de la V3 de Paseo del Sena reparada, contra el dev server que
// apunta a la base VIVA. Complementa a capturas-174.ts (que ya bajó el PDF).
// Reintenta cada página: Neon tira P1001/P2024 esporádicos en frío.

import { readFileSync, mkdirSync } from "fs";
import { chromium, type Page } from "playwright";
import { encode } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3040";
const OUT = "scripts/_capturas";

function envValor(clave: string, archivo: string): string {
  const m = readFileSync(archivo, "utf8").match(new RegExp(`^${clave}=["']?(.+?)["']?$`, "m"));
  if (!m) throw new Error(`falta ${clave} en ${archivo}`);
  return m[1];
}

const URL_VIVA = envValor("DATABASE_URL", "/Users/mjblanco/Desktop/blarq-app/.env.prod");
if (!/ep-shy-morning/.test(URL_VIVA)) throw new Error("ABORTO: no es la base viva");
const prisma = new PrismaClient({ datasourceUrl: URL_VIVA });

async function capturar(page: Page, url: string, archivo: string, esperar: string) {
  for (let intento = 1; intento <= 4; intento++) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    try {
      await page.waitForSelector(`text=${esperar}`, { timeout: 30000 });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${OUT}/${archivo}`, fullPage: true });
      console.log(`  ✔ ${archivo}`);
      return;
    } catch {
      console.log(`  · intento ${intento} falló (${archivo}), reintentando…`);
      await page.waitForTimeout(3000);
    }
  }
  throw new Error(`no pude capturar ${archivo}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const proyecto = await prisma.project.findFirstOrThrow({ where: { numeroProyecto: 64 }, select: { id: true, name: true } });
  const v3 = await prisma.budgetVersion.findFirstOrThrow({
    where: { projectId: proyecto.id, type: "obra", version: "V3" }, select: { id: true },
  });
  const maestros = await prisma.maestro.findMany({
    where: { obraItems: { some: { budgetVersionId: v3.id } } }, select: { id: true, name: true },
  });
  const user = await prisma.user.findFirstOrThrow({ where: { role: "admin" }, select: { id: true, email: true, name: true, role: true } });

  const token = await encode({
    token: { sub: user.id, email: user.email, name: user.name, role: user.role },
    secret: envValor("NEXTAUTH_SECRET", "/Users/mjblanco/Desktop/blarq-app/.env"),
    salt: "authjs.session-token", maxAge: 3600,
  });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: "authjs.session-token", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();

  await capturar(page, `${BASE}/proyectos/${proyecto.id}/presupuesto`, "174-lista-versiones.png", "V3");
  await capturar(page, `${BASE}/proyectos/${proyecto.id}/estados-pago`, "174-estados-pago.png", "Estados de pago");
  for (const m of maestros) {
    const slug = m.name.toLowerCase().normalize("NFD").replace(/[^a-z]+/g, "-");
    await capturar(page, `${BASE}/proyectos/${proyecto.id}/estados-pago/maestro/${m.id}`, `174-ep-${slug}.png`, m.name.split(" ")[0]);
  }
  await browser.close();
  console.log("listo");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
