/**
 * Verificación visual de los capítulos de obra con nombre libre y orden a mano.
 *
 * Levanta un Chromium real contra el dev server de este worktree, se autentica
 * firmando una cookie de NextAuth (la app usa JWT), y ejercita el flujo
 * completo con clicks y ARRASTRES de verdad:
 *
 *   1. Crea un capítulo con un nombre inventado desde "+ Capítulo".
 *   2. Le mete una partida.
 *   3. Lo arrastra a otra posición (drag real con el mouse).
 *   4. Renombra un capítulo existente.
 *   5. Recarga y comprueba que el orden y los nombres quedaron guardados.
 *
 * Deja las capturas en scripts/_capturas/ para mostrárselas a MJ.
 *
 * Uso: npx tsx scripts/verify-capitulos-obra.ts <baseUrl> <projectId> <budgetId>
 */
import { chromium, type Page } from "playwright";
import { PrismaClient } from "@prisma/client";
import { readFileSync, mkdirSync } from "fs";
import { hkdf } from "@panva/hkdf";

const BASE = process.argv[2] ?? "http://localhost:3093";
const PROJECT_ID = process.argv[3]!;
const BUDGET_ID = process.argv[4]!;
const OUT = "scripts/_capturas";

const env = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const SECRET = env.match(/NEXTAUTH_SECRET\s*=\s*"?([^"\n]+)"?/)![1].trim();
const DB_URL = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });

// Los 8 nombres/orden con que quedó el presupuesto después de migrar. Se usan
// para dejar la obra como estaba antes de cada corrida (el script se corre
// varias veces mientras se ajusta).
const ORDEN_BASE = [
  "DEMOLICIONES",
  "OBRA GRUESA",
  "REPARACIONES",
  "INSTALACIONES SANITARIAS Y GASFITERIA",
  "INSTALACIONES ELECTRICAS",
  "TERMINACIONES",
  "LIMPIEZA Y ASEO",
  "ADICIONALES",
];

async function resetear() {
  // Borrar capítulos de prueba vacíos y sus partidas de prueba.
  await prisma.obraItem.deleteMany({
    where: { budgetVersionId: BUDGET_ID, name: "PERGOLA DE MADERA" },
  });
  await prisma.obraChapter.deleteMany({
    where: { budgetVersionId: BUDGET_ID, name: { startsWith: "TERRAZA" } },
  });
  // La partida manual también se guarda sola en el catálogo (best-effort);
  // la sacamos para que la corrida siguiente no choque con el unique.
  await prisma.partidaCatalog.deleteMany({
    where: { name: "PERGOLA DE MADERA" },
  });
  await prisma.obraChapter.updateMany({
    where: { budgetVersionId: BUDGET_ID, name: "ASEO FINAL DE OBRA" },
    data: { name: "LIMPIEZA Y ASEO" },
  });
  // Devolver el orden original.
  const caps = await prisma.obraChapter.findMany({
    where: { budgetVersionId: BUDGET_ID },
  });
  for (const c of caps) {
    const i = ORDEN_BASE.indexOf(c.name);
    await prisma.obraChapter.update({
      where: { id: c.id },
      data: { sortOrder: i >= 0 ? i : 90 },
    });
  }
}

// NextAuth v5 deriva la clave de cifrado del secret con HKDF y guarda el token
// como JWE. Replicamos eso para entrar sin tipear la clave de MJ.
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

async function capturar(page: Page, nombre: string) {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${nombre}.png`, fullPage: false });
  console.log(`  captura: ${OUT}/${nombre}.png`);
}

// Texto de la barra de cada capítulo, en el orden en que se ven.
async function ordenDeCapitulos(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("h3")]
      .filter((h) => h.closest(".bg-gray-200"))
      .map((h) => h.textContent!.replace(/\s+/g, " ").trim())
  );
}

async function main() {
  await resetear();
  const token = await cookieDeSesion();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1500, height: 1000 },
  });
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
  page.on("pageerror", (e) => console.log("  [error de página]", e.message));
  page.on("dialog", (d) => {
    console.log("  [alerta de la app]", d.message());
    d.accept();
  });
  page.on("response", async (r) => {
    if (r.status() >= 400 && r.url().includes("/api/")) {
      console.log(`  [API ${r.status()}] ${r.url()} → ${(await r.text()).slice(0, 200)}`);
    }
  });

  const url = `${BASE}/proyectos/${PROJECT_ID}/presupuesto/${BUDGET_ID}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  console.log("\n1) Estado inicial");
  console.log("   ", (await ordenDeCapitulos(page)).join(" | "));
  await capturar(page, "1-antes");

  console.log("\n2) Crear capítulo 'TERRAZA Y JARDIN' desde + Capítulo");
  await page.getByRole("button", { name: "+ Capítulo" }).click();
  await capturar(page, "2-panel-capitulo");
  await page.getByPlaceholder("Ej: TERRAZA Y JARDIN").fill("TERRAZA Y JARDIN");
  await page.getByRole("button", { name: "Crear" }).click();
  await page.waitForTimeout(800);
  console.log("   ", (await ordenDeCapitulos(page)).join(" | "));
  await capturar(page, "3-capitulo-creado");

  console.log("\n3) Agregar una partida al capítulo nuevo");
  const barraNueva = page
    .locator(".bg-gray-200")
    .filter({ hasText: "TERRAZA Y JARDIN" });
  await barraNueva.getByRole("button", { name: "+ Agregar" }).click();
  await page.waitForTimeout(400);
  // El formulario arranca en el buscador de catálogo; "Crear nueva" abre el
  // formulario a mano.
  await page.getByRole("button", { name: "Crear nueva" }).click();
  await page.waitForTimeout(300);
  await page.getByPlaceholder("Nombre de la partida").fill("PERGOLA DE MADERA");
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  // El dev server compila la ruta en el primer golpe: hay que darle aire.
  await page.waitForTimeout(4000);
  console.log("   ", (await ordenDeCapitulos(page)).join(" | "));
  await capturar(page, "4-partida-agregada");

  console.log("\n4) Arrastrar 'TERRAZA Y JARDIN' hasta el lugar de TERMINACIONES");
  // Dejamos ORIGEN y DESTINO a la vista antes de arrastrar: si el recorrido es
  // largo, dnd-kit auto-scrollea la página y el punto donde se suelta ya no es
  // el que se apuntó (le pasa al robot, no a una persona, que ve el resalte).
  const destino = page
    .locator(".bg-gray-200")
    .filter({ hasText: "TERMINACIONES" })
    .first();
  await destino.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const manijaNueva = barraNueva.getByLabel("Mover capítulo");
  const o = await manijaNueva.boundingBox();
  const d = await destino.boundingBox();
  if (!o || !d) throw new Error("no se pudo ubicar la manija o el destino");
  await page.mouse.move(o.x + o.width / 2, o.y + o.height / 2);
  await page.mouse.down();
  // dnd-kit necesita varios movimientos para pasar el umbral y calcular el over.
  const destY = d.y + d.height / 2;
  for (let i = 1; i <= 15; i++) {
    await page.mouse.move(o.x + o.width / 2, o.y + (destY - o.y) * (i / 15));
    await page.waitForTimeout(50);
  }
  // dnd-kit auto-scrollea cuando el cursor se acerca al borde: la barra de
  // destino se mueve bajo el mouse. Re-medimos y apuntamos a donde QUEDÓ, para
  // soltar de verdad encima de ella (una persona hace esto mirando el resalte).
  for (let i = 0; i < 6; i++) {
    const actual = await destino.boundingBox();
    if (!actual) break;
    await page.mouse.move(
      actual.x + actual.width / 2,
      actual.y + actual.height / 2
    );
    await page.waitForTimeout(120);
  }
  await capturar(page, "5-arrastrando");
  await page.mouse.up();
  await page.waitForTimeout(1500);
  console.log("   ", (await ordenDeCapitulos(page)).join(" | "));
  await capturar(page, "6-despues-de-arrastrar");

  console.log("\n5) Renombrar 'LIMPIEZA Y ASEO' a 'ASEO FINAL DE OBRA'");
  // Ojo: al entrar en modo edición el nombre deja de ser texto y pasa a ser el
  // value de un input, así que el filtro por texto ya no sirve — hay que
  // quedarse con la barra ANTES de hacer click.
  const barraLimpieza = page
    .locator(".bg-gray-200")
    .filter({ hasText: "LIMPIEZA Y ASEO" })
    .first();
  await barraLimpieza.getByRole("button", { name: "LIMPIEZA Y ASEO" }).click();
  await page.waitForTimeout(400);
  const input = page.locator(".bg-gray-200 input").first();
  await input.fill("ASEO FINAL DE OBRA");
  await input.press("Enter");
  await page.waitForTimeout(2000);
  await capturar(page, "7-renombrado");

  console.log("\n6) Recargar para comprobar que quedó guardado");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const final = await ordenDeCapitulos(page);
  console.log("   ", final.join(" | "));
  await capturar(page, "8-despues-de-recargar");

  await browser.close();
  await prisma.$disconnect();

  console.log("\n=== RESULTADO ===");
  const texto = final.join(" | ");
  const chequeos: [string, boolean][] = [
    ["El capítulo nuevo existe", texto.includes("TERRAZA Y JARDIN")],
    [
      "Quedó donde lo solté (5to, el lugar que tenía TERMINACIONES)",
      /5TERRAZAYJARDIN/.test(texto.replace(/\s/g, "")),
    ],
    [
      "TERMINACIONES corrió al 6to",
      /6TERMINACIONES/.test(texto.replace(/\s/g, "")),
    ],
    ["El renombrado se guardó", texto.includes("ASEO FINAL DE OBRA")],
    ["Ya no dice LIMPIEZA Y ASEO", !texto.includes("LIMPIEZA Y ASEO")],
  ];
  for (const [q, ok] of chequeos) console.log(`  ${ok ? "OK  " : "FALLA"} ${q}`);
  if (chequeos.some(([, ok]) => !ok)) process.exit(1);
}

main().catch(async (e) => {
  console.error("ERROR:", e);
  await prisma.$disconnect();
  process.exit(1);
});
