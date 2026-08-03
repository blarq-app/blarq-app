/**
 * Mover el % de descuento a mano tiene que funcionar de verdad: quedar
 * guardado, marcarse como decisión de MJ, y NO despegar la línea.
 *
 * Existe por un error real: el PUT miraba `discountOverridden === false` para
 * decidir si MJ pedía "volver al de la tienda", pero el editor manda la FILA
 * COMPLETA en cada guardado, con el valor viejo. Así, cualquier cambio de
 * porcentaje en una línea sin descuento propio se interpretaba como "volvé al
 * de la tienda" y el número recién escrito se pisaba con el del catálogo.
 *
 * Pega contra el PUT real, igual que lo hace el editor.
 *
 *   npx tsx scripts/test-mover-el-descuento.ts [url]
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

const CLP = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("es-CL"));
let ok = 0, fail = 0;
function check(n: string, c: boolean, d = "") { c ? ok++ : fail++; console.log(`  ${c ? "OK  " : "FALL"} ${n}${d ? ` — ${d}` : ""}`); }

async function cookie(): Promise<string> {
  const { EncryptJWT } = await import("jose");
  const salt = "authjs.session-token";
  const key = await hkdf("sha256", SECRET, salt, `Auth.js Generated Encryption Key (${salt})`, 64);
  return await new EncryptJWT({ name: "MJ Blanco", email: "mjblanco@blarq.cl", sub: "test" })
    .setProtectedHeader({ alg: "dir", enc: "A256CBC-HS512" })
    .setIssuedAt().setExpirationTime("1h").setJti("test-mover-dcto").encrypt(key);
}

async function main() {
  if (!/solitary-mud/.test(DB)) throw new Error("Solo dev. Abortado.");
  console.log("Base:", DB.match(/@([^/]+)/)?.[1]);
  const ck = await cookie();

  const proyecto = await prisma.project.create({
    data: { name: "__TEST_MOVER_DCTO__", clientName: "__TEST__", status: "cotizacion" },
  });
  const cat = await prisma.artefactoCatalog.create({
    data: { name: "GRIFERÍA TEST DCTO", subcategory: "sanitario", listPrice: 100000, discountPercent: 0.2 },
  });
  const bv = await prisma.budgetVersion.create({
    data: { projectId: proyecto.id, version: "V1", type: "artefactos", status: "borrador" },
  });
  const item = await prisma.artefactoItem.create({
    data: {
      budgetVersionId: bv.id, room: "bano", subcategory: "sanitario", name: "GRIFERÍA TEST DCTO",
      quantity: 1, listPrice: 100000, discountPercent: 0.2, clientPrice: 80000,
      catalogId: cat.id, priceOverridden: false, discountOverridden: false,
    },
  });

  // Cómo guarda el editor: manda la fila entera con el campo cambiado.
  const guardar = async (extra: Record<string, unknown>) => {
    const actual = await prisma.artefactoItem.findUnique({ where: { id: item.id } });
    const res = await fetch(`${BASE}/api/presupuestos/${bv.id}/artefactos/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: `authjs.session-token=${ck}` },
      body: JSON.stringify({ ...actual, ...extra }),
    });
    return res.ok;
  };

  try {
    console.log("\n1. MJ escribe 45% donde la tienda da 20%:");
    await guardar({ discountPercent: 0.45, clientPrice: 55000 });
    let d = await prisma.artefactoItem.findUnique({ where: { id: item.id } });
    check("el 45% QUEDA guardado", Math.abs((d?.discountPercent ?? 0) - 0.45) < 0.001, `${((d?.discountPercent ?? 0) * 100).toFixed(0)}%`);
    check("el precio al cliente es 100.000 − 45%", Math.abs((d?.clientPrice ?? 0) - 55000) < 1, CLP(d?.clientPrice));
    check("queda marcado como descuento de MJ", d?.discountOverridden === true);
    check("y la línea NO se despega", d?.priceOverridden === false);

    console.log("\n2. Se guarda otra cosa de la misma línea (la cantidad):");
    await guardar({ quantity: 3 });
    d = await prisma.artefactoItem.findUnique({ where: { id: item.id } });
    check("el 45% sigue ahí (no lo pisó el del catálogo)", Math.abs((d?.discountPercent ?? 0) - 0.45) < 0.001, `${((d?.discountPercent ?? 0) * 100).toFixed(0)}%`);
    check("sigue marcado como de MJ", d?.discountOverridden === true);

    console.log("\n3. MJ aprieta la flechita de volver al de la tienda:");
    await guardar({ volverAlDescuentoDeLaTienda: true });
    d = await prisma.artefactoItem.findUnique({ where: { id: item.id } });
    check("toma el 20% del catálogo", Math.abs((d?.discountPercent ?? 0) - 0.2) < 0.001, `${((d?.discountPercent ?? 0) * 100).toFixed(0)}%`);
    check("el precio vuelve a 80.000", Math.abs((d?.clientPrice ?? 0) - 80000) < 1, CLP(d?.clientPrice));
    check("deja de estar marcado como de MJ", d?.discountOverridden === false);
  } finally {
    await prisma.artefactoItem.deleteMany({ where: { budgetVersionId: bv.id } });
    await prisma.budgetVersion.delete({ where: { id: bv.id } });
    await prisma.artefactoCatalog.delete({ where: { id: cat.id } });
    await prisma.project.delete({ where: { id: proyecto.id } });
    console.log("\nDatos de prueba borrados.");
    await prisma.$disconnect();
  }
  console.log(`\nRESULTADO: ${ok} OK, ${fail} FALL`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
