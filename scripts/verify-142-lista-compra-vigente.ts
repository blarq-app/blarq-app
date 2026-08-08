/**
 * Verificación en pantalla del pendiente 142 — la Lista de compra sigue la
 * versión VIGENTE, no "la aprobada".
 *
 * SOLO LECTURA: navega la app como MJ, no escribe nada.
 * Corre contra la base dev (ep-solitary-mud); aborta si no lo es.
 *
 * Saca dos pantallas por corrida:
 *   1. Casa Los Algarrobos (copia de datos reales de la viva): V1 enviada vs
 *      V2 borrador.
 *   2. Portofino con V1 aprobada + V2 enviada — el caso que describe MJ.
 *
 * Se corre DOS veces, una con el código viejo y otra con el nuevo, pasando el
 * rótulo como argumento:
 *   npx tsx scripts/verify-142-lista-compra-vigente.ts antes   [baseUrl]
 *   npx tsx scripts/verify-142-lista-compra-vigente.ts despues [baseUrl]
 */
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { readFileSync, mkdirSync } from "fs";
import { hkdf } from "@panva/hkdf";

const ROTULO = process.argv[2] ?? "despues";
const BASE = process.argv[3] ?? "http://localhost:3211";
const OUT = "scripts/_capturas";

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
    "sha256", SECRET, salt,
    `Auth.js Generated Encryption Key (${salt})`, 64
  );
  return await new EncryptJWT({
    name: "MJ Blanco", email: "mjblanco@blarq.cl", sub: "verificacion",
  })
    .setProtectedHeader({ alg: "dir", enc: "A256CBC-HS512" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .setJti("verificacion")
    .encrypt(key);
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const casos = [
    { slug: "algarrobos", nombre: "Casa Los Algarrobos" },
    { slug: "portofino", nombre: "Portofino" },
  ];

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies([
    {
      name: "authjs.session-token", value: await cookieDeSesion(),
      domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax",
    },
  ]);
  const page = await ctx.newPage();

  for (const c of casos) {
    const p = await prisma.project.findFirst({
      where: { name: c.nombre },
      select: {
        id: true, name: true,
        budgetVersions: {
          where: { type: "obra" },
          select: { version: true, status: true, createdAt: true },
        },
      },
    });
    if (!p) {
      console.log(`(salteado: no está "${c.nombre}" en dev)`);
      continue;
    }
    const versiones = [...p.budgetVersions]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((v) => `${v.version}:${v.status}`)
      .join(" · ");

    await page.goto(`${BASE}/proyectos/${p.id}/lista-compra`, {
      waitUntil: "networkidle",
    });
    // El selector de presupuesto es lo que delata qué versión tomó la pantalla.
    await page.waitForSelector("select", { timeout: 30000 });
    const elegida = await page
      .locator("select")
      .first()
      .locator("option:checked")
      .textContent();
    const materiales = await page.locator("tbody tr").count();

    const file = `${OUT}/142-${c.slug}-${ROTULO}.png`;
    await page.screenshot({ path: file, fullPage: false });

    console.log(`${c.nombre}  [${versiones}]`);
    console.log(`  ${ROTULO.toUpperCase()} → la lista toma: ${elegida?.trim()}`);
    console.log(`  filas de material en pantalla: ${materiales}`);
    console.log(`  captura: ${file}`);
  }

  await browser.close();
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
