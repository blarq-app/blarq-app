// Capturas de la V3 de Paseo del Sena ya reparada, contra el dev server
// levantado apuntando a la base VIVA — para que MJ apruebe mirando el
// resultado y no el código (CLAUDE.md §4.10).
//
// Saca: el PDF de obra que genera la app, el pantallazo de la lista de
// versiones y el de los estados de pago por maestro.
//
// La sesión se acuña firmando un token de NextAuth (no se tipea ninguna
// clave ni se inyecta cookie por JS). Ver la nota de "capturas del dev
// logueado" en la memoria del proyecto.
//
//   npx tsx scripts/capturas-174.ts

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { chromium } from "playwright";
import { encode } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";

const PORT = 3040;
const BASE = `http://localhost:${PORT}`;
const OUT = "scripts/_capturas";

function envValor(clave: string, archivo: string): string {
  const raw = readFileSync(archivo, "utf8");
  const m = raw.match(new RegExp(`^${clave}=["']?(.+?)["']?$`, "m"));
  if (!m) throw new Error(`falta ${clave} en ${archivo}`);
  return m[1];
}

const URL_VIVA = envValor("DATABASE_URL", "/Users/mjblanco/Desktop/blarq-app/.env.prod");
if (!/ep-shy-morning/.test(URL_VIVA)) throw new Error("ABORTO: no es la base viva");
const prisma = new PrismaClient({ datasourceUrl: URL_VIVA });

async function main() {
  mkdirSync(OUT, { recursive: true });

  const proyecto = await prisma.project.findFirstOrThrow({
    where: { numeroProyecto: 64 },
    select: { id: true, name: true },
  });
  const v3 = await prisma.budgetVersion.findFirstOrThrow({
    where: { projectId: proyecto.id, type: "obra", version: "V3" },
    select: { id: true },
  });
  const maestros = await prisma.maestro.findMany({
    where: { obraItems: { some: { budgetVersionId: v3.id } } },
    select: { id: true, name: true },
  });
  console.log(`#64 ${proyecto.name} · V3 ${v3.id} · maestros: ${maestros.map((m) => m.name).join(", ")}`);

  const user = await prisma.user.findFirstOrThrow({
    where: { role: "admin" },
    select: { id: true, email: true, name: true, role: true },
  });

  const secret = envValor("NEXTAUTH_SECRET", "/Users/mjblanco/Desktop/blarq-app/.env");
  const token = await encode({
    token: { sub: user.id, email: user.email, name: user.name, role: user.role },
    secret,
    salt: "authjs.session-token",
    maxAge: 60 * 60,
  });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: "authjs.session-token", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();

  // 1 · el PDF de obra tal como lo genera la app hoy
  console.log("bajando el PDF de obra…");
  const resp = await page.request.get(`${BASE}/api/presupuestos/${v3.id}/pdf`, { timeout: 180000 });
  if (!resp.ok()) throw new Error(`el PDF devolvió ${resp.status()}: ${(await resp.text()).slice(0, 300)}`);
  const pdf = await resp.body();
  writeFileSync(`${OUT}/174-sena-v3-reparada.pdf`, pdf);
  console.log(`  PDF guardado (${(pdf.length / 1e6).toFixed(1)} MB)`);

  // 2 · lista de versiones del presupuesto
  console.log("capturando la lista de versiones…");
  await page.goto(`${BASE}/proyectos/${proyecto.id}/presupuesto`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/174-lista-versiones.png`, fullPage: true });

  // 3 · estados de pago por maestro
  console.log("capturando los estados de pago…");
  await page.goto(`${BASE}/proyectos/${proyecto.id}/estados-pago`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/174-estados-pago.png`, fullPage: true });

  for (const m of maestros) {
    await page.goto(`${BASE}/proyectos/${proyecto.id}/estados-pago/maestro/${m.id}`, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForTimeout(2500);
    const slug = m.name.toLowerCase().replace(/[^a-z]+/g, "-");
    await page.screenshot({ path: `${OUT}/174-ep-${slug}.png`, fullPage: true });
    console.log(`  ${m.name} listo`);
  }

  await browser.close();
  console.log(`\nlisto — archivos en ${OUT}/`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
