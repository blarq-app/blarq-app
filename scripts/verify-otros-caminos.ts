/**
 * Smoke test de los otros lugares que tocan capítulos de obra:
 *
 *   1. Duplicar una versión → los capítulos se copian (con su nombre y orden)
 *      y las partidas quedan en el capítulo equivalente de la copia, NO en el
 *      de la versión original.
 *   2. Comparador de versiones → carga y empareja por nombre de capítulo.
 *   3. Resumen del proyecto (avance por capítulo) → carga.
 *   4. Página de maestros (selector de partidas por capítulo) → carga.
 *
 * Uso: npx tsx scripts/verify-otros-caminos.ts <baseUrl>
 */
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { hkdf } from "@panva/hkdf";

const BASE = process.argv[2] ?? "http://localhost:3093";
const env = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const SECRET = env.match(/NEXTAUTH_SECRET\s*=\s*"?([^"\n]+)"?/)![1].trim();
const DB_URL = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });

const PROYECTO = "cmousut2b0001rtjjpbq3wi9z"; // Constanza Bravo
const BV_ORIGEN = "cmoxk6zdf001drtr4ydd9ljgx"; // V1_Con ampliación (tiene el capítulo inventado)

async function cookieDeSesion(): Promise<string> {
  const { EncryptJWT } = await import("jose");
  const salt = "authjs.session-token";
  const key = await hkdf("sha256", SECRET, salt, `Auth.js Generated Encryption Key (${salt})`, 64);
  return await new EncryptJWT({ name: "MJ Blanco", email: "mjblanco@blarq.cl", sub: "verificacion" })
    .setProtectedHeader({ alg: "dir", enc: "A256CBC-HS512" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .setJti("verificacion")
    .encrypt(key);
}

const resultados: [string, boolean, string][] = [];
function chequeo(nombre: string, ok: boolean, detalle = "") {
  resultados.push([nombre, ok, detalle]);
  console.log(`  ${ok ? "OK  " : "FALLA"} ${nombre}${detalle ? " — " + detalle : ""}`);
}

async function main() {
  const token = await cookieDeSesion();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addCookies([
    { name: "authjs.session-token", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  const page = await ctx.newPage();
  const erroresDePagina: string[] = [];
  page.on("pageerror", (e) => erroresDePagina.push(e.message));

  console.log("\n1) Duplicar la versión");
  const res = await page.request.post(`${BASE}/api/presupuestos`, {
    data: { projectId: PROYECTO, type: "obra", baseVersionId: BV_ORIGEN },
  });
  if (!res.ok()) throw new Error(`duplicar → ${res.status()} ${await res.text()}`);
  const copia = (await res.json()) as { id: string };

  const origen = await prisma.budgetVersion.findUnique({
    where: { id: BV_ORIGEN },
    include: { obraChapters: { orderBy: { sortOrder: "asc" } }, obraItems: true },
  });
  const nueva = await prisma.budgetVersion.findUnique({
    where: { id: copia.id },
    include: { obraChapters: { orderBy: { sortOrder: "asc" } }, obraItems: true },
  });
  if (!origen || !nueva) throw new Error("no se encontró alguna versión");

  chequeo(
    "la copia tiene los mismos capítulos, con el mismo nombre y orden",
    JSON.stringify(origen.obraChapters.map((c) => [c.name, c.sortOrder])) ===
      JSON.stringify(nueva.obraChapters.map((c) => [c.name, c.sortOrder])),
    nueva.obraChapters.map((c) => c.name).join(" | ")
  );
  chequeo(
    "la copia tiene la misma cantidad de partidas",
    origen.obraItems.length === nueva.obraItems.length,
    `${nueva.obraItems.length} partidas`
  );
  const idsOrigen = new Set(origen.obraChapters.map((c) => c.id));
  chequeo(
    "las partidas de la copia NO apuntan a los capítulos de la versión original",
    nueva.obraItems.every((i) => i.chapterId && !idsOrigen.has(i.chapterId))
  );
  chequeo(
    "ninguna partida de la copia quedó sin capítulo",
    nueva.obraItems.every((i) => i.chapterId !== null)
  );
  // El reparto por capítulo tiene que ser el mismo en las dos.
  const repartoDe = (v: typeof origen) => {
    const nombre = new Map(v.obraChapters.map((c) => [c.id, c.name]));
    const m = new Map<string, number>();
    for (const i of v.obraItems) {
      const k = i.chapterId ? nombre.get(i.chapterId) ?? "?" : "(sin capítulo)";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return JSON.stringify([...m.entries()].sort());
  };
  chequeo("cada capítulo de la copia tiene las mismas partidas", repartoDe(origen) === repartoDe(nueva));

  console.log("\n2) Comparador de versiones");
  erroresDePagina.length = 0;
  await page.goto(`${BASE}/proyectos/${PROYECTO}/presupuesto/comparar?a=${BV_ORIGEN}&b=${copia.id}`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(1200);
  const textoComparar = await page.locator("body").innerText();
  chequeo("el comparador carga sin errores", erroresDePagina.length === 0, erroresDePagina[0] ?? "");
  chequeo(
    "el comparador muestra el capítulo inventado",
    textoComparar.includes("TERRAZA Y JARDIN")
  );
  await page.screenshot({ path: "scripts/_capturas/11-comparar-versiones.png" });

  console.log("\n3) Resumen del proyecto (avance por capítulo)");
  erroresDePagina.length = 0;
  await page.goto(`${BASE}/proyectos/${PROYECTO}/resumen`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  // "Avance Obra por Capítulo" viene colapsado en un <details>: hay que abrirlo
  // para poder leer su contenido.
  await page.evaluate(() =>
    document.querySelectorAll("details").forEach((d) => (d.open = true))
  );
  await page.waitForTimeout(400);
  const textoResumen = await page.locator("body").innerText();
  chequeo("el resumen carga sin errores", erroresDePagina.length === 0, erroresDePagina[0] ?? "");
  chequeo(
    "el resumen lista el avance por capítulo",
    /Avance Obra por Cap/i.test(textoResumen) &&
      /DEMOLICIONES|TERMINACIONES/i.test(textoResumen)
  );
  await page.screenshot({ path: "scripts/_capturas/12-resumen-avance.png", fullPage: true });

  console.log("\n4) Página de maestros (selector de partidas por capítulo)");
  erroresDePagina.length = 0;
  // Cualquier proyecto que tenga maestros repartidos sirve para este chequeo.
  const maestro = await prisma.projectMaestro.findFirst({});
  if (maestro) {
    await page.goto(
      `${BASE}/proyectos/${maestro.projectId}/estados-pago/maestro/${maestro.maestroId}`,
      { waitUntil: "networkidle" }
    );
    await page.waitForTimeout(1500);
    await page.evaluate(() =>
      document.querySelectorAll("button").forEach((b) => {
        if (/reparto|partidas/i.test(b.textContent ?? "")) b.click();
      })
    );
    await page.waitForTimeout(800);
    const textoMaestro = await page.locator("body").innerText();
    chequeo("la página del maestro carga sin errores", erroresDePagina.length === 0, erroresDePagina[0] ?? "");
    chequeo(
      "el selector de partidas agrupa por capítulo",
      /DEMOLICIONES|TERMINACIONES|SANITARIAS/i.test(textoMaestro)
    );
    await page.screenshot({ path: "scripts/_capturas/13-maestro-partidas.png", fullPage: true });
  } else {
    console.log("     (no hay maestros repartidos en dev — se saltea)");
  }

  // Limpieza: la copia de prueba se borra.
  await prisma.budgetVersion.delete({ where: { id: copia.id } });
  await browser.close();
  await prisma.$disconnect();

  const fallas = resultados.filter(([, ok]) => !ok);
  console.log(`\n=== ${resultados.length - fallas.length}/${resultados.length} chequeos OK ===`);
  if (fallas.length > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error("ERROR:", e);
  await prisma.$disconnect();
  process.exit(1);
});
