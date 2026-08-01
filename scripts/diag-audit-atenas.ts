/**
 * Auditoría precios artefactos — caso WC ATENAS. SOLO LECTURA.
 * Lee DATABASE_URL directo de .env.prod (sin dotenv) y verifica marcadores
 * de la base viva antes de sacar conclusiones (§4.9).
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const envRaw = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8");
const m = envRaw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
if (!m) throw new Error("No DATABASE_URL en .env.prod");
const url = m[1];
console.log("HOST:", new URL(url.replace(/^postgres(ql)?:/, "https:")).hostname);

const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  // Marcadores de base viva
  const p64 = await prisma.project.findFirst({ where: { numeroProyecto: 64 }, select: { name: true } }).catch(() => null);
  console.log("Proyecto #64:", JSON.stringify(p64));
  const lastInv = await prisma.invoice.findFirst({ orderBy: { issueDate: "desc" }, select: { issueDate: true } }).catch(() => null);
  console.log("Última factura:", lastInv?.issueDate);

  // Catálogo: WC ATENAS
  const cats = await prisma.artefactoCatalog.findMany({
    where: { name: { contains: "ATENAS", mode: "insensitive" } },
    select: { id: true, name: true, detail: true, brand: true, supplier: true, listPrice: true, discountPercent: true, clientPrice: true, realCostBlarq: true, referenceLink: true, lastPriceCheck: true, updatedAt: true },
  });
  console.log("\n=== ArtefactoCatalog ATENAS ===");
  for (const c of cats) console.log(JSON.stringify(c, null, 1));

  // Ítems de cotización con ATENAS (los más recientes primero)
  const items = await prisma.artefactoItem.findMany({
    where: { name: { contains: "ATENAS", mode: "insensitive" } },
    select: {
      id: true, name: true, detail: true, room: true, quantity: true,
      listPrice: true, discountPercent: true, clientPrice: true, realCostBlarq: true,
      priceOverridden: true, catalogId: true, referenceLink: true,
      budgetVersion: {
        select: { id: true, version: true, status: true, createdAt: true,
          project: { select: { name: true } } },
      },
    },
  });
  console.log("\n=== ArtefactoItem ATENAS (" + items.length + ") ===");
  for (const it of items) {
    const bv = it.budgetVersion;
    console.log(
      `${bv?.project?.name ?? "?"} V${bv?.version} [${bv?.status}] ${bv?.createdAt?.toISOString()?.slice(0, 10)} | ${it.name} (${it.room}) | lista=${it.listPrice} dcto=${it.discountPercent} cliente=${it.clientPrice} costo=${it.realCostBlarq} overridden=${it.priceOverridden} catalogId=${it.catalogId ? "sí" : "no"}`
    );
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
// (extensión) nombres de proyecto de los presupuestos con ATENAS
