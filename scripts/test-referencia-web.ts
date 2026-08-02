/**
 * El ciclo que describió MJ: un producto se cae de la tienda y vuelve un mes
 * después. La app no puede quedarse sin la referencia de internet en el medio.
 *
 * Corre contra DEV y contra el endpoint real de "Revisar precios". Crea un
 * producto de prueba y lo borra al final.
 *
 *   npx tsx scripts/test-referencia-web.ts [url]
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

const CLP = (n: number | null | undefined) =>
  n == null ? "—" : "$" + Math.round(n).toLocaleString("es-CL");

// Un producto que SÍ existe en MK, y uno con link inventado (simula la baja).
const LINK_VIVO = "https://www.mk.cl/wcs300257-wc-atenas-pison-rimless-sanitarios/p";
const LINK_CAIDO = "https://www.mk.cl/xxx999999-producto-dado-de-baja-sanitarios/p";

let ok = 0, fail = 0;
function check(n: string, c: boolean, d = "") {
  c ? ok++ : fail++;
  console.log(`  ${c ? "OK  " : "FALL"} ${n}${d ? ` — ${d}` : ""}`);
}

async function cookie(): Promise<string> {
  const { EncryptJWT } = await import("jose");
  const salt = "authjs.session-token";
  const key = await hkdf("sha256", SECRET, salt, `Auth.js Generated Encryption Key (${salt})`, 64);
  return await new EncryptJWT({ name: "MJ Blanco", email: "mjblanco@blarq.cl", sub: "test" })
    .setProtectedHeader({ alg: "dir", enc: "A256CBC-HS512" })
    .setIssuedAt().setExpirationTime("1h").setJti("test-ref-web").encrypt(key);
}

async function revisar(id: string, ck: string) {
  const res = await fetch(`${BASE}/api/catalogo/artefactos/revisar-precios`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `authjs.session-token=${ck}` },
    body: JSON.stringify({ ids: [id] }),
  });
  const data = await res.json();
  return data.rows?.[0];
}

async function main() {
  if (!/solitary-mud/.test(DB)) throw new Error("Solo dev. Abortado.");
  console.log("Base:", DB.match(/@([^/]+)/)?.[1]);
  const ck = await cookie();

  const cat = await prisma.artefactoCatalog.create({
    data: { name: "ZZ TEST REFERENCIA WEB", subcategory: "sanitario", listPrice: 229840,
      discountPercent: 0.3, referenceLink: LINK_VIVO },
  });

  try {
    console.log("\n1. El producto está en la tienda y se revisa:");
    await revisar(cat.id, ck);
    let c = await prisma.artefactoCatalog.findUnique({ where: { id: cat.id } });
    check("guardó lo que cobra la tienda", (c?.webSalePrice ?? 0) > 0, CLP(c?.webSalePrice));
    check("guardó la fecha de la lectura", c?.webCheckedAt != null);
    check("no está marcado como ilegible", c?.webUnreadableSince == null);
    const precioGuardado = c?.webSalePrice;
    const fechaGuardada = c?.webCheckedAt;

    console.log("\n2. MK lo da de baja (el link deja de responder):");
    await prisma.artefactoCatalog.update({ where: { id: cat.id }, data: { referenceLink: LINK_CAIDO } });
    const fila = await revisar(cat.id, ck);
    c = await prisma.artefactoCatalog.findUnique({ where: { id: cat.id } });
    check("marca desde cuándo no se puede leer", c?.webUnreadableSince != null);
    check("NO borra el precio que había leído", c?.webSalePrice === precioGuardado, CLP(c?.webSalePrice));
    check("NO borra la fecha de esa lectura", c?.webCheckedAt?.getTime() === fechaGuardada?.getTime());
    check("la pantalla recibe la última lectura buena", fila?.ultimaLecturaBuena?.salePrice === precioGuardado,
      `${CLP(fila?.ultimaLecturaBuena?.salePrice)} del ${String(fila?.ultimaLecturaBuena?.cuando).slice(0, 10)}`);
    check("el precio que se le cobra al cliente NO se tocó", c?.listPrice === 229840 && Math.abs((c?.discountPercent ?? 0) - 0.3) < 0.001);

    console.log("\n3. Un mes después vuelve a aparecer:");
    await prisma.artefactoCatalog.update({ where: { id: cat.id }, data: { referenceLink: LINK_VIVO } });
    await revisar(cat.id, ck);
    c = await prisma.artefactoCatalog.findUnique({ where: { id: cat.id } });
    check("se limpia la marca de ilegible", c?.webUnreadableSince == null);
    check("vuelve a leer el precio de la tienda", (c?.webSalePrice ?? 0) > 0, CLP(c?.webSalePrice));
    check("la fecha de lectura se actualizó",
      (c?.webCheckedAt?.getTime() ?? 0) >= (fechaGuardada?.getTime() ?? 0));
  } finally {
    await prisma.artefactoCatalog.delete({ where: { id: cat.id } }).catch(() => {});
    console.log("\nProducto de prueba borrado.");
    await prisma.$disconnect();
  }
  console.log(`\nRESULTADO: ${ok} OK, ${fail} FALL`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
