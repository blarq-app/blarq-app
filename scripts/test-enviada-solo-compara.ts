/**
 * Artefactos: en una cotización YA ENVIADA las ventanas "Comparar con mi
 * catálogo" y "Comparar con la tienda web" comparan, pero no aplican.
 *
 * Regla de MJ (2026-09-29): "No se deben tocar cotizaciones ya enviadas". La
 * pantalla ya no muestra tildes ni botón en una enviada, pero el control de
 * verdad está en el servidor — este test pega contra las rutas REALES:
 *   - POST .../artefactos/actualizar-catalogo  → 409 si no es borrador.
 *   - PUT  .../artefactos/{itemId} con `desdeLaTienda` (o los campos de precio
 *     o descuento de la tienda) → 409 si no es borrador.
 *   - PUT  .../artefactos/{itemId} SIN esos campos (la edición en la línea)
 *     → sigue guardando en cualquier estado. Bloquearla es otra decisión.
 *   - Comparar (los GET) sigue abierto en una enviada.
 * Y en un borrador todo sigue como antes.
 *
 * Crea todo lo que necesita y lo borra al final. Nunca contra la base viva.
 *
 *   npx tsx scripts/test-enviada-solo-compara.ts <url-app> <env-con-DATABASE_URL>
 *   npx tsx scripts/test-enviada-solo-compara.ts http://localhost:3491 scripts/_tmp-enviada/local.env
 */
import { readFileSync } from "fs";
import hkdf from "@panva/hkdf";
import { PrismaClient, type ArtefactoItem } from "@prisma/client";

const [BASE, envDb] = process.argv.slice(2);
if (!BASE || !envDb) throw new Error("uso: <url-app> <env-con-DATABASE_URL>");
const leer = (ruta: string, clave: string) =>
  readFileSync(ruta, "utf8").match(new RegExp(`${clave}\\s*=\\s*"?([^"\\n]+)"?`))?.[1]?.trim();
const DB = leer(envDb, "DATABASE_URL");
// El secreto con que firma la app: el .env de la carpeta principal (el mismo
// que usan los otros tests del editor).
const SECRET = leer("/Users/mjblanco/Desktop/blarq-app/.env", "NEXTAUTH_SECRET");
if (!DB || !SECRET) throw new Error("Falta DATABASE_URL o NEXTAUTH_SECRET.");
if (/shy-morning/.test(DB) || !/localhost|127\.0\.0\.1|solitary-mud/.test(DB))
  throw new Error("Solo contra una base local o la de desarrollo. Abortado.");
const prisma = new PrismaClient({ datasources: { db: { url: DB } } });

let ok = 0;
let fail = 0;
function check(nombre: string, cond: boolean, detalle = "") {
  if (cond) ok++;
  else fail++;
  console.log(`  ${cond ? "OK  " : "FALL"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}
const CLP = (n: number | null | undefined) =>
  n == null ? "—" : "$" + Math.round(n).toLocaleString("es-CL");
const cerca = (a: number | null | undefined, b: number) => a != null && Math.abs(a - b) < 1;

async function cookie(): Promise<string> {
  const { EncryptJWT } = await import("jose");
  const salt = "authjs.session-token";
  const key = await hkdf("sha256", SECRET!, salt, `Auth.js Generated Encryption Key (${salt})`, 64);
  return await new EncryptJWT({ name: "MJ Blanco", email: "mjblanco@blarq.cl", sub: "test-enviada" })
    .setProtectedHeader({ alg: "dir", enc: "A256CBC-HS512" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .setJti("test-enviada-solo-compara")
    .encrypt(key);
}
let ck = "";
// Devuelve el status HTTP: acá lo que se prueba es justamente cuándo la ruta
// dice que no.
async function pedir(metodo: string, ruta: string, cuerpo?: unknown): Promise<number> {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", Cookie: `authjs.session-token=${ck}` },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  await res.text();
  return res.status;
}
const releer = (id: string) => prisma.artefactoItem.findUniqueOrThrow({ where: { id } });

// Guarda una línea como lo hace el editor: la FILA COMPLETA con el cambio,
// más los campos de acción que correspondan.
async function guardar(
  bvId: string,
  id: string,
  cambio: Partial<ArtefactoItem>,
  accion: Record<string, unknown> = {},
): Promise<number> {
  const fila = await releer(id);
  const nueva = { ...fila, ...cambio };
  if (cambio.listPrice !== undefined || cambio.discountPercent !== undefined) {
    nueva.clientPrice = nueva.listPrice * (1 - (nueva.discountPercent ?? 0));
  }
  return pedir("PUT", `/api/presupuestos/${bvId}/artefactos/${id}`, { ...nueva, ...accion });
}

async function main() {
  console.log("Base:", DB!.match(/@([^/]+)/)?.[1], "· App:", BASE, "\n");
  ck = await cookie();

  const proyecto = await prisma.project.create({
    data: { name: "__TEST_ENVIADA_SOLO_COMPARA__", clientName: "__TEST__", status: "cotizacion" },
  });
  const cat = await prisma.artefactoCatalog.create({
    data: { name: "ZZENV WC", subcategory: "sanitario", listPrice: 200000, discountPercent: 0.3, realCostBlarq: 90000 },
  });
  const version = (v: string, status: string) =>
    prisma.budgetVersion.create({ data: { projectId: proyecto.id, version: v, type: "artefactos", status } });
  // Cada línea con su nombre: el guardado copia a las gemelas por nombre.
  const linea = (bvId: string, name: string) =>
    prisma.artefactoItem.create({
      data: {
        budgetVersionId: bvId,
        room: "bano_principal",
        subcategory: "sanitario",
        name,
        quantity: 1,
        listPrice: 100000,
        discountPercent: 0.2,
        clientPrice: 80000,
        realCostBlarq: 50000,
        catalogId: cat.id,
        sortOrder: 0,
      },
    });

  try {
    for (const status of ["enviado", "aprobado", "rechazado"]) {
      console.log(`\nCotización ${status.toUpperCase()}:`);
      const bv = await version(`V-${status}`, status);
      const a = await linea(bv.id, `ZZENV ${status} A`);

      check(
        "'Comparar con mi catálogo' compara (GET 200)",
        (await pedir("GET", `/api/presupuestos/${bv.id}/artefactos/actualizar-catalogo`)) === 200,
      );
      const stCat = await pedir("POST", `/api/presupuestos/${bv.id}/artefactos/actualizar-catalogo`, {
        patches: [{ itemId: a.id, listPrice: 200000, discountPercent: 0.3, realCostBlarq: 90000 }],
      });
      check("'Comparar con mi catálogo' no aplica (409)", stCat === 409, `status ${stCat}`);
      let r = await releer(a.id);
      check(
        "precio y costo quedan igual",
        cerca(r.clientPrice, 80000) && cerca(r.realCostBlarq, 50000),
        `${CLP(r.clientPrice)} · costo ${CLP(r.realCostBlarq)}`,
      );

      const stWeb = await guardar(bv.id, a.id, { listPrice: 150000, discountPercent: 0.1 }, {
        desdeLaTienda: true, precioDeLaTienda: true, descuentoDeLaTienda: true,
      });
      check("'Comparar con la tienda web' no aplica el precio (409)", stWeb === 409, `status ${stWeb}`);
      const stFoto = await guardar(bv.id, a.id, { imageUrl: "https://example.com/otra.jpg" }, { desdeLaTienda: true });
      check("tampoco la sola foto (409)", stFoto === 409, `status ${stFoto}`);
      r = await releer(a.id);
      check(
        "la línea queda igual",
        cerca(r.clientPrice, 80000) && r.imageUrl === null,
        `${CLP(r.clientPrice)} · foto ${r.imageUrl ?? "—"}`,
      );

      // La edición en la línea (sin campos de acción) sigue permitida.
      const stMano = await guardar(bv.id, a.id, { listPrice: 110000 });
      r = await releer(a.id);
      check(
        "tipear un precio en la línea sigue guardando",
        stMano === 200 && cerca(r.clientPrice, 88000),
        `status ${stMano} · ${CLP(r.clientPrice)}`,
      );
    }

    console.log("\nCotización BORRADOR (todo como antes):");
    const bv = await version("V-borrador", "borrador");
    const a = await linea(bv.id, "ZZENV borrador A");
    const b = await linea(bv.id, "ZZENV borrador B");
    const stCat = await pedir("POST", `/api/presupuestos/${bv.id}/artefactos/actualizar-catalogo`, {
      patches: [{ itemId: a.id, listPrice: 200000, discountPercent: 0.3, realCostBlarq: 90000 }],
    });
    let r = await releer(a.id);
    check(
      "'Comparar con mi catálogo' aplica",
      stCat === 200 && cerca(r.clientPrice, 140000) && cerca(r.realCostBlarq, 90000),
      `status ${stCat} · ${CLP(r.clientPrice)} · costo ${CLP(r.realCostBlarq)}`,
    );
    const stWeb = await guardar(bv.id, b.id, { listPrice: 150000, discountPercent: 0.1 }, {
      desdeLaTienda: true, precioDeLaTienda: true, descuentoDeLaTienda: true,
    });
    r = await releer(b.id);
    check(
      "'Comparar con la tienda web' aplica",
      stWeb === 200 && cerca(r.clientPrice, 135000),
      `status ${stWeb} · ${CLP(r.clientPrice)}`,
    );

    console.log("\nLínea de otra cotización:");
    const otra = await prisma.budgetVersion.findFirstOrThrow({
      where: { projectId: proyecto.id, status: "enviado" },
    });
    const stCruzado = await guardar(bv.id, (await prisma.artefactoItem.findFirstOrThrow({
      where: { budgetVersionId: otra.id },
    })).id, { listPrice: 1 }, { desdeLaTienda: true });
    check("aplicar con el id de una línea ajena no pasa (404)", stCruzado === 404, `status ${stCruzado}`);
  } finally {
    await prisma.budgetVersion.deleteMany({ where: { projectId: proyecto.id } });
    await prisma.project.delete({ where: { id: proyecto.id } }).catch(() => {});
    await prisma.artefactoCatalog.delete({ where: { id: cat.id } }).catch(() => {});
    console.log("\nDatos de prueba borrados.");
  }

  console.log("─".repeat(60));
  console.log(`RESULTADO: ${ok} OK, ${fail} FALL`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
