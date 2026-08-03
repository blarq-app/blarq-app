/**
 * Verificación e2e del arreglo de precios de artefactos (2026-07-31), contra la
 * base de DESARROLLO (ep-solitary-mud). NUNCA la viva.
 *
 * Reproduce el caso real de MJ: el WC ATENAS PISO-N RIMLESS quedó en la
 * cotización con la foto del catálogo del 14-07 (lista $229.840, 30%, cliente
 * $160.840) mientras mk.cl hoy lo tiene con 39% = $139.990. Con el código viejo
 * "Comparar con la tienda web" decía "coincide"; con el arreglo lo detecta y al
 * aplicar deja el precio de la tienda.
 *
 * Qué hace:
 *   1. Siembra el ítem de prueba en una cotización de artefactos de dev.
 *   2. Abre el editor logueado, saca foto del modal (lo que MJ va a ver).
 *   3. Aplica el cambio marcado y verifica en la base cómo quedó la línea.
 *   4. BORRA el ítem sembrado en un finally (dev queda como estaba).
 *
 * Correr con el dev server arriba:
 *   npx tsx scripts/verify-precios-artefactos-e2e.ts [url]
 */
import "dotenv/config";
import { readFileSync, mkdirSync } from "fs";
import { chromium, type Page } from "playwright";
import hkdf from "@panva/hkdf";
import { PrismaClient } from "@prisma/client";

const BASE = process.argv[2] ?? "http://localhost:3157";
const OUT = "docs/auditoria-artefactos-precios-2026-07-assets";

const env = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const SECRET = env.match(/NEXTAUTH_SECRET\s*=\s*"?([^"\n]+)"?/)![1].trim();
const DB = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();

const prisma = new PrismaClient({ datasources: { db: { url: DB } } });

// Los valores exactos que tiene hoy la cotización de MJ en la base viva.
const CASO = {
  name: "WC ATENAS PISO-N RIMLESS",
  detail:
    "WC Atenas piso-n rimless: vaso descarga a piso + estanque doble descarga 3/6L",
  brand: "KLIPEN",
  listPrice: 229840,
  discountPercent: 0.3002088409328229,
  clientPrice: 160840,
  referenceLink:
    "https://www.mk.cl/wcs300257-wc-atenas-pison-rimless-sanitarios/p",
};

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
    .setJti("verificacion-precios-artefactos")
    .encrypt(key);
}

async function capturarModal(page: Page, nombre: string) {
  mkdirSync(OUT, { recursive: true });
  const ruta = `${OUT}/${nombre}.png`;
  // El modal es el panel blanco dentro del overlay fixed.
  const modal = page.locator("div.fixed.inset-0.z-50 > div").first();
  await modal.screenshot({ path: ruta });
  console.log("  capturado:", ruta);
}

async function main() {
  console.log("Base:", DB.match(/@([^/]+)/)?.[1]);
  if (!/solitary-mud/.test(DB)) {
    throw new Error("Esto corre SOLO contra dev (ep-solitary-mud). Abortado.");
  }

  // 1. Buscar una cotización de artefactos en borrador donde sembrar.
  const bv = await prisma.budgetVersion.findFirst({
    where: { type: "artefactos", status: "borrador" },
    select: { id: true, version: true, project: { select: { name: true, id: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (!bv) throw new Error("No hay cotización de artefactos en borrador en dev.");
  console.log(`Cotización de prueba: ${bv.project?.name} ${bv.version} (${bv.id})`);

  let itemId: string | null = null;
  try {
    const item = await prisma.artefactoItem.create({
      data: {
        budgetVersionId: bv.id,
        room: "bano_principal",
        subcategory: "sanitario",
        quantity: 1,
        sortOrder: 9999,
        priceOverridden: false,
        ...CASO,
      },
      select: { id: true },
    });
    itemId = item.id;
    console.log("Ítem sembrado:", itemId);

    // 2. Abrir el editor logueado y el modal.
    const browser = await chromium.launch();
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 2,
    });
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
    // OJO: la ruta es /presupuesto/ en SINGULAR.
    await page.goto(`${BASE}/proyectos/${bv.project!.id}/presupuesto/${bv.id}`, {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await page.waitForTimeout(1500);

    await page.getByRole("button", { name: /Comparar con la tienda web/i }).click();
    // La lectura de las tiendas tarda: esperamos a que desaparezca el cargando.
    await page.waitForFunction(
      () => !document.body.innerText.includes("Revisando los links"),
      undefined,
      { timeout: 90000 }
    );
    await page.waitForTimeout(800);
    await capturarModal(page, "modal-comparar-tienda-web-despues");

    // 3. Verificar que el WC aparece como DISTINTO con el descuento nuevo.
    const texto = await page.locator("div.fixed.inset-0.z-50").innerText();
    // OJO: el rótulo se dibuja en mayúscula por CSS y innerText lo devuelve
    // transformado — la comparación tiene que ser insensible a mayúsculas.
    const saleEnDistintos =
      /distintos/i.test(texto) && /WC ATENAS PISO-N RIMLESS/.test(texto);
    console.log(
      saleEnDistintos
        ? "OK   | el WC aparece en 'Distintos' (antes caía en 'Coinciden')"
        : "FALLA | el WC no aparece como distinto"
    );
    const muestra39 = /39\s*%/.test(texto);
    console.log(
      muestra39
        ? "OK   | el modal muestra el 39% de la tienda"
        : "FALLA | el modal no muestra el descuento nuevo"
    );

    // 4. Aplicar y comprobar cómo quedó en la base.
    //
    // GOTCHA: el guardado va por un PUT que tarda ~4s y el editor NO lo espera
    // (dispara el fetch y sigue). Si acá se lee la base con un timeout fijo, se
    // lee ANTES de que el PUT termine y encima el finally borra el ítem con el
    // guardado en vuelo — el PUT muere con P2025 y parece que el arreglo falló.
    // Hay que esperar la respuesta HTTP concreta.
    const esperaPut = page.waitForResponse(
      (r) =>
        /\/artefactos\/[^/]+$/.test(new URL(r.url()).pathname) &&
        r.request().method() === "PUT",
      { timeout: 60000 }
    );
    await page
      .getByRole("button", { name: /Aplicar cambios marcados/i })
      .click();
    const put = await esperaPut;
    console.log(`   (PUT respondió ${put.status()})`);
    await page.waitForTimeout(2000);

    const despues = await prisma.artefactoItem.findUnique({
      where: { id: itemId },
      select: {
        listPrice: true,
        discountPercent: true,
        clientPrice: true,
        priceOverridden: true,
        discountOverridden: true,
      },
    });
    console.log("\nCómo quedó la línea en la base:");
    console.log(
      `   lista ${despues?.listPrice} · dcto ${((despues?.discountPercent ?? 0) * 100).toFixed(1)}% · cliente ${Math.round(despues?.clientPrice ?? 0)} · despegada ${despues?.priceOverridden} · dcto propio ${despues?.discountOverridden}`
    );
    const okCliente = Math.abs((despues?.clientPrice ?? 0) - 139990) <= 1;
    const okDcto = Math.abs((despues?.discountPercent ?? 0) - 0.3909) < 0.01;
    console.log(
      okCliente
        ? "OK   | el precio al cliente quedó en $139.990, igual que la tienda"
        : `FALLA | quedó en ${Math.round(despues?.clientPrice ?? 0)} y debía ser 139.990`
    );
    console.log(
      okDcto
        ? "OK   | el descuento guardado es el 39% de la tienda"
        : `FALLA | descuento ${((despues?.discountPercent ?? 0) * 100).toFixed(1)}%`
    );

    await page.waitForTimeout(500);
    await browser.close();
  } finally {
    // 5. Dejar dev como estaba.
    if (itemId) {
      await prisma.artefactoItem.delete({ where: { id: itemId } }).catch(() => {});
      console.log("\nÍtem de prueba borrado — dev queda como estaba.");
    }
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
