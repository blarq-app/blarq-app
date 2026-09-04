// Detalle de un estado de pago cerrado de Jefrey Gómez, para confirmar que
// las líneas re-enganchadas (F) se ven y los montos siguen intactos.

import { readFileSync, mkdirSync } from "fs";
import { chromium } from "playwright";
import { encode } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3040";
const OUT = "scripts/_capturas";

function envValor(clave: string, archivo: string): string {
  const m = readFileSync(archivo, "utf8").match(new RegExp(`^${clave}=["']?(.+?)["']?$`, "m"));
  if (!m) throw new Error(`falta ${clave}`);
  return m[1];
}
const URL_VIVA = envValor("DATABASE_URL", "/Users/mjblanco/Desktop/blarq-app/.env.prod");
if (!/ep-shy-morning/.test(URL_VIVA)) throw new Error("ABORTO: no es la base viva");
const prisma = new PrismaClient({ datasourceUrl: URL_VIVA });

async function main() {
  mkdirSync(OUT, { recursive: true });
  const eps = await prisma.estadoPago.findMany({
    where: { project: { numeroProyecto: 64 }, status: "cerrado" },
    select: { id: true, number: true, maestro: { select: { name: true } } },
    orderBy: { number: "desc" },
    take: 1,
  });
  const ep = eps[0];
  console.log(`EP #${ep.number} de ${ep.maestro?.name} · ${ep.id}`);

  const user = await prisma.user.findFirstOrThrow({ where: { role: "admin" }, select: { id: true, email: true, name: true, role: true } });
  const token = await encode({
    token: { sub: user.id, email: user.email, name: user.name, role: user.role },
    secret: envValor("NEXTAUTH_SECRET", "/Users/mjblanco/Desktop/blarq-app/.env"),
    salt: "authjs.session-token", maxAge: 3600,
  });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: "authjs.session-token", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();

  const proyecto = await prisma.project.findFirstOrThrow({ where: { numeroProyecto: 64 }, select: { id: true } });
  for (let i = 1; i <= 4; i++) {
    await page.goto(`${BASE}/proyectos/${proyecto.id}/estados-pago/${ep.id}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    try {
      await page.waitForSelector("text=Jefrey", { timeout: 30000 });
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${OUT}/174-ep-detalle.png`, fullPage: true });
      console.log("  ✔ 174-ep-detalle.png");
      break;
    } catch { console.log(`  · intento ${i} falló, reintentando…`); await page.waitForTimeout(3000); }
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
