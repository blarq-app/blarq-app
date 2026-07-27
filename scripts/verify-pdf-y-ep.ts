/**
 * Genera las pruebas para que MJ apruebe mirando, no leyendo código:
 *
 *   A) El PDF de una obra que tiene un capítulo INVENTADO por ella
 *      ("TERRAZA Y JARDIN"), en la posición donde lo puso.
 *   B) El PDF de una obra que NO se tocó, para comparar contra el de antes.
 *   C) La pantalla del Estado de Pago y su PDF, con los capítulos.
 *
 * Deja todo en scripts/_capturas/.
 *
 * Uso: npx tsx scripts/verify-pdf-y-ep.ts <baseUrl>
 */
import { chromium, type Page } from "playwright";
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { hkdf } from "@panva/hkdf";

const BASE = process.argv[2] ?? "http://localhost:3093";
const OUT = "scripts/_capturas";

const env = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const SECRET = env.match(/NEXTAUTH_SECRET\s*=\s*"?([^"\n]+)"?/)![1].trim();
const DB_URL = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });

const BV_CON_CAPITULO_NUEVO = "cmoxk6zdf001drtr4ydd9ljgx"; // Constanza Bravo V1_Con ampliación
const PROY_CON_CAPITULO_NUEVO = "cmousut2b0001rtjjpbq3wi9z";
const BV_INTACTO = "cmo7r261e0001rta3g4vwvium"; // Lefevre V5 — no se toca
const EP_INTACTO = "cmogflose0001rt2r83bvn2eu"; // EP 1 de Lefevre
const PROY_INTACTO = "cmnx59uvq0000rty9ouec5i25"; // Lefevre

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

// Le damos plata a la partida del capítulo nuevo: si su mano de obra es $0, el
// estado de pago la esconde (regla de "partidas sin MO de este maestro") y no
// se vería el capítulo nuevo en el EP, que es justo lo que hay que mostrar.
async function prepararPartidaDePrueba() {
  const cap = await prisma.obraChapter.findFirst({
    where: { budgetVersionId: BV_CON_CAPITULO_NUEVO, name: "TERRAZA Y JARDIN" },
  });
  if (!cap) throw new Error("Falta el capítulo de prueba — corré antes verify-capitulos-obra.ts");
  await prisma.obraItem.updateMany({
    where: { chapterId: cap.id, name: "PERGOLA DE MADERA" },
    data: {
      quantity: 12,
      unitPrice: 85000,
      total: 12 * 85000,
      costLabor: 30000,
      costMaterial: 40000,
      unit: "M2",
      descriptionCliente:
        "PERGOLA DE MADERA IMPREGNADA EN LA TERRAZA, SEGUN PLANO",
      descriptionMaestro: "PERGOLA DE MADERA IMPREGNADA — 12 M2",
    },
  });
}

async function bajarPDF(page: Page, url: string, archivo: string) {
  const res = await page.request.get(url);
  if (!res.ok()) throw new Error(`${url} → ${res.status()}`);
  const buf = await res.body();
  writeFileSync(`${OUT}/${archivo}`, buf);
  console.log(`  PDF: ${OUT}/${archivo}  (${Math.round(buf.length / 1024)} KB)`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await prepararPartidaDePrueba();

  const token = await cookieDeSesion();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
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

  console.log("\nA) PDF de la obra CON el capítulo nuevo");
  await bajarPDF(
    page,
    `${BASE}/api/presupuestos/${BV_CON_CAPITULO_NUEVO}/pdf`,
    "PDF-obra-con-capitulo-nuevo.pdf"
  );

  console.log("\nB) PDF de una obra que NO se tocó (Lefevre V5)");
  await bajarPDF(
    page,
    `${BASE}/api/presupuestos/${BV_INTACTO}/pdf`,
    "PDF-obra-sin-tocar.pdf"
  );

  console.log("\nC) PDF del maestro y Excel del maestro (misma obra nueva)");
  await bajarPDF(
    page,
    `${BASE}/api/presupuestos/${BV_CON_CAPITULO_NUEVO}/maestro`,
    "PDF-maestro-con-capitulo-nuevo.pdf"
  );

  console.log("\nD) Estado de Pago que ya existía (Lefevre EP 1) — pantalla");
  await page.goto(`${BASE}/proyectos/${PROY_INTACTO}/estados-pago/${EP_INTACTO}`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(1500);
  const capsEP = await page.evaluate(() =>
    [...document.querySelectorAll("h3")]
      .filter((h) => h.closest(".bg-\\[\\#DBDBDB\\]"))
      .map((h) => h.textContent!.replace(/\s+/g, " ").trim())
  );
  console.log("   capítulos en pantalla:", capsEP.join(" | ") || "(ninguno)");
  await page.screenshot({ path: `${OUT}/9-estado-de-pago.png` });
  console.log(`   captura: ${OUT}/9-estado-de-pago.png`);

  console.log("\nE) PDF de ese Estado de Pago");
  await bajarPDF(page, `${BASE}/api/estados-pago/${EP_INTACTO}/pdf`, "PDF-estado-de-pago.pdf");

  console.log("\nF) Estado de Pago NUEVO sobre la obra con el capítulo inventado");
  // Se borra el de la corrida anterior para poder repetir la prueba.
  await prisma.estadoPago.deleteMany({
    where: { projectId: PROY_CON_CAPITULO_NUEVO },
  });
  const creado = await page.request.post(
    `${BASE}/api/proyectos/${PROY_CON_CAPITULO_NUEVO}/estados-pago`,
    { data: { budgetVersionId: BV_CON_CAPITULO_NUEVO } }
  );
  if (!creado.ok()) throw new Error(`crear EP → ${creado.status()} ${await creado.text()}`);
  const ep = (await creado.json()) as { id: string };
  await page.goto(
    `${BASE}/proyectos/${PROY_CON_CAPITULO_NUEVO}/estados-pago/${ep.id}`,
    { waitUntil: "networkidle" }
  );
  await page.waitForTimeout(1500);
  const capsNuevo = await page.evaluate(() =>
    [...document.querySelectorAll("h3")]
      .filter((h) => h.closest(".bg-\\[\\#DBDBDB\\]"))
      .map((h) => h.textContent!.replace(/\s+/g, " ").trim())
  );
  console.log("   capítulos en pantalla:", capsNuevo.join(" | ") || "(ninguno)");
  await page.screenshot({ path: `${OUT}/10-ep-con-capitulo-nuevo.png`, fullPage: true });
  console.log(`   captura: ${OUT}/10-ep-con-capitulo-nuevo.png`);
  await bajarPDF(
    page,
    `${BASE}/api/estados-pago/${ep.id}/pdf`,
    "PDF-estado-de-pago-con-capitulo-nuevo.pdf"
  );

  const okCapNuevo = capsNuevo.some((c) => c.includes("TERRAZA Y JARDIN"));
  const okRenombrado = capsNuevo.some((c) => c.includes("ASEO FINAL DE OBRA"));
  console.log(
    `\n   ${okCapNuevo ? "OK  " : "FALLA"} el capítulo inventado aparece en el EP`
  );
  console.log(
    `   ${okRenombrado ? "OK  " : "FALLA"} el capítulo renombrado aparece con su nombre nuevo`
  );

  await browser.close();
  await prisma.$disconnect();
  console.log("\nListo.");
}

main().catch(async (e) => {
  console.error("ERROR:", e);
  await prisma.$disconnect();
  process.exit(1);
});
