/**
 * ¿Qué gestos despegan una línea de cotización sin que MJ toque ningún precio?
 *
 * MJ reportó líneas marcadas como "no siguen al catálogo" en una cotización
 * donde asegura no haber editado ni un número. Este script prueba, uno por uno,
 * los gestos que se pueden hacer en el editor sin tocar plata, y mira cuáles
 * dejan la línea despegada.
 *
 * Corre contra la base de DESARROLLO. Siembra una línea de prueba pegada al
 * catálogo, hace el gesto pegándole al PUT real (el mismo que usa el editor,
 * que manda la FILA COMPLETA), y consulta cómo quedó. Borra todo al final.
 *
 *   npx tsx scripts/diag-que-despega-una-linea.ts [url]
 */
import "dotenv/config";
import { readFileSync } from "fs";
import hkdf from "@panva/hkdf";
import { PrismaClient } from "@prisma/client";

const BASE = process.argv[2] ?? "http://localhost:3157";
const env = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const SECRET = env.match(/NEXTAUTH_SECRET\s*=\s*"?([^"\n]+)"?/)![1].trim();
const DB = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const prisma = new PrismaClient({ datasources: { db: { url: DB } } });

async function cookie(): Promise<string> {
  const { EncryptJWT } = await import("jose");
  const salt = "authjs.session-token";
  const key = await hkdf("sha256", SECRET, salt, `Auth.js Generated Encryption Key (${salt})`, 64);
  return await new EncryptJWT({ name: "MJ Blanco", email: "mjblanco@blarq.cl", sub: "diag" })
    .setProtectedHeader({ alg: "dir", enc: "A256CBC-HS512" })
    .setIssuedAt().setExpirationTime("1h").setJti("diag-despegue").encrypt(key);
}

// Cómo llega la fila al editor (lo que el server manda al cliente) y cómo la
// devuelve `persistItem`: entera, con el campo cambiado.
interface Fila {
  id: string; room: string; subcategory: string; name: string;
  detail: string | null; brand: string | null; quantity: number;
  listPrice: number; discountPercent: number | null; clientPrice: number;
  realCostBlarq: number | null; referenceLink: string | null;
  imageUrl: string | null; catalogId: string | null; sortOrder: number;
}

async function main() {
  if (!/solitary-mud/.test(DB)) throw new Error("Solo contra dev. Abortado.");
  console.log("Base:", DB.match(/@([^/]+)/)?.[1], "\n");
  const ck = await cookie();

  const bv = await prisma.budgetVersion.findFirst({
    where: { type: "artefactos", status: "borrador" },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (!bv) throw new Error("No hay cotización de artefactos en borrador en dev.");

  const cat = await prisma.artefactoCatalog.findFirst({
    where: { referenceLink: { not: null } },
    select: { id: true, name: true, detail: true, brand: true, listPrice: true, discountPercent: true, referenceLink: true, imageUrl: true },
  });
  if (!cat) throw new Error("No hay producto de catálogo en dev.");

  // Los escenarios: qué campo cambia el gesto, y con qué valores nace la línea.
  // `detalleNull` sirve para probar el caso "la base tiene null y el editor
  // manda cadena vacía".
  const ESCENARIOS: Array<{
    nombre: string;
    detalleNull: boolean;
    marcaNull: boolean;
    patch: (f: Fila) => Partial<Fila>;
  }> = [
    { nombre: "cambiar la CANTIDAD (fila completa, campos con texto)", detalleNull: false, marcaNull: false, patch: (f) => ({ quantity: f.quantity + 1 }) },
    { nombre: "cambiar la CANTIDAD (con detalle y marca VACÍOS en la base)", detalleNull: true, marcaNull: true, patch: (f) => ({ quantity: f.quantity + 1 }) },
    { nombre: "REORDENAR la fila (sortOrder)", detalleNull: false, marcaNull: false, patch: (f) => ({ sortOrder: f.sortOrder + 1 }) },
    { nombre: "cambiar el AMBIENTE del bloque (room)", detalleNull: false, marcaNull: false, patch: () => ({ room: "bano_otro" }) },
    { nombre: "GUARDAR el popover de link/foto SIN cambiar nada", detalleNull: false, marcaNull: false, patch: (f) => ({ referenceLink: f.referenceLink, imageUrl: f.imageUrl }) },
    { nombre: "guardar con la FOTO vacía cuando la base tiene null", detalleNull: false, marcaNull: false, patch: () => ({ imageUrl: "" as unknown as string }) },
    // El modal "Comparar con la tienda web" pre-marca la casilla de IMAGEN
    // cuando la tienda tiene una foto distinta, aunque el precio coincida. Al
    // aplicar va por el mismo PUT, con la fila entera.
    { nombre: "aplicar del modal SOLO la imagen (el precio no cambia)", detalleNull: false, marcaNull: false, patch: () => ({ imageUrl: "https://ejemplo.cl/foto-nueva.jpg" }) },
    { nombre: "aplicar del modal solo el precio de LISTA, con el mismo valor", detalleNull: false, marcaNull: false, patch: (f) => ({ listPrice: f.listPrice }) },
  ];

  for (const esc of ESCENARIOS) {
    const creado = await prisma.artefactoItem.create({
      data: {
        budgetVersionId: bv.id, room: "bano_principal", subcategory: "sanitario",
        name: cat.name,
        detail: esc.detalleNull ? null : (cat.detail ?? "Detalle de prueba"),
        brand: esc.marcaNull ? null : (cat.brand ?? "MARCA"),
        quantity: 1, listPrice: cat.listPrice,
        discountPercent: cat.discountPercent,
        clientPrice: cat.listPrice * (1 - (cat.discountPercent ?? 0)),
        referenceLink: cat.referenceLink, imageUrl: cat.imageUrl,
        catalogId: cat.id, priceOverridden: false, sortOrder: 5000,
      },
    });

    // El editor manda la fila COMPLETA. Reproducimos eso: leemos como la ve el
    // cliente y aplicamos el patch del gesto.
    const fila: Fila = {
      id: creado.id, room: creado.room, subcategory: creado.subcategory,
      name: creado.name, detail: creado.detail, brand: creado.brand,
      quantity: creado.quantity, listPrice: creado.listPrice,
      discountPercent: creado.discountPercent, clientPrice: creado.clientPrice,
      realCostBlarq: creado.realCostBlarq, referenceLink: creado.referenceLink,
      imageUrl: creado.imageUrl, catalogId: creado.catalogId, sortOrder: creado.sortOrder,
    };
    const enviado = { ...fila, ...esc.patch(fila) };

    const res = await fetch(`${BASE}/api/presupuestos/${bv.id}/artefactos/${creado.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: `authjs.session-token=${ck}` },
      body: JSON.stringify(enviado),
    });
    const despues = await prisma.artefactoItem.findUnique({
      where: { id: creado.id },
      select: { priceOverridden: true },
    });
    const despego = despues?.priceOverridden === true;
    console.log(
      `${despego ? "DESPEGA  " : "no despega"} | ${esc.nombre}${res.ok ? "" : `  (HTTP ${res.status})`}`
    );
    await prisma.artefactoItem.delete({ where: { id: creado.id } }).catch(() => {});
  }
  console.log("\nLíneas de prueba borradas — dev queda como estaba.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
