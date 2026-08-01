/**
 * Auditoría precios artefactos — panorama global del catálogo. SOLO LECTURA.
 * Cuenta frescura de lastPriceCheck, tiendas, y candidatos a datos viejos
 * (dcto 0 con link de tienda que sí publica descuentos).
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const envRaw = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env.prod", "utf8");
const url = envRaw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1];
const prisma = new PrismaClient({ datasources: { db: { url } } });

function host(u: string | null): string {
  if (!u) return "(sin link)";
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "(link inválido)"; }
}

async function main() {
  const cats = await prisma.artefactoCatalog.findMany({
    select: { id: true, name: true, subcategory: true, listPrice: true, discountPercent: true, clientPrice: true, referenceLink: true, lastPriceCheck: true },
  });
  console.log("Total catálogo:", cats.length);

  const byHost = new Map<string, number>();
  for (const c of cats) byHost.set(host(c.referenceLink), (byHost.get(host(c.referenceLink)) ?? 0) + 1);
  console.log("\nPor tienda:");
  for (const [h, n] of [...byHost.entries()].sort((a, b) => b[1] - a[1])) console.log(` ${h}: ${n}`);

  const now = new Date("2026-07-31");
  const buckets = { nunca: 0, "≤7 días": 0, "8-30 días": 0, ">30 días": 0 };
  for (const c of cats) {
    if (!c.lastPriceCheck) { buckets.nunca++; continue; }
    const d = (now.getTime() - new Date(c.lastPriceCheck).getTime()) / 86400000;
    if (d <= 7) buckets["≤7 días"]++; else if (d <= 30) buckets["8-30 días"]++; else buckets[">30 días"]++;
  }
  console.log("\nFrescura de lastPriceCheck:", JSON.stringify(buckets));

  const conDcto = cats.filter((c) => (c.discountPercent ?? 0) > 0).length;
  const sinDctoConLinkMK = cats.filter((c) => (c.discountPercent ?? 0) === 0 && /mk\.cl|ledstudio\.cl|kitchenhouse\.cl/.test(c.referenceLink ?? "")).length;
  const conClientPriceExplicito = cats.filter((c) => c.clientPrice != null && Math.abs(c.clientPrice - Math.round(c.listPrice * (1 - (c.discountPercent ?? 0)))) > 1);
  console.log("\nCon dcto > 0:", conDcto);
  console.log("Con dcto 0 y link a tienda con API de dcto:", sinDctoConLinkMK);
  console.log("Con clientPrice explícito DISTINTO de lista×(1−dcto):", conClientPriceExplicito.length);
  for (const c of conClientPriceExplicito.slice(0, 15)) {
    console.log(`  ${c.name} [${c.subcategory}]: lista=${c.listPrice} dcto=${c.discountPercent} → calc=${Math.round(c.listPrice * (1 - (c.discountPercent ?? 0)))} vs clientPrice=${c.clientPrice}`);
  }

  // Ítems despegados en cotizaciones en borrador (no los pisa nada)
  const borradorItems = await prisma.artefactoItem.findMany({
    where: { budgetVersion: { status: "borrador", type: "artefactos" } },
    select: { priceOverridden: true, catalogId: true },
  });
  const despegados = borradorItems.filter((i) => i.priceOverridden).length;
  const sinCatalogo = borradorItems.filter((i) => !i.catalogId).length;
  console.log(`\nÍtems en cotizaciones BORRADOR: ${borradorItems.length} — despegados: ${despegados}, sin catalogId: ${sinCatalogo}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
