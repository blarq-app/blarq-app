/**
 * refresh-prices.ts
 * Actualiza los precios de MaterialCatalog leyendo las páginas de Sodimac
 * para los materiales que tienen referenceLink de Sodimac.
 *
 * Uso:
 *   npx tsx scripts/refresh-prices.ts          → revisa todos, muestra diff
 *   npx tsx scripts/refresh-prices.ts --apply  → revisa y guarda en DB
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const DELAY_MS = 600; // pausa entre requests para no saturar Sodimac

// ── helpers ──────────────────────────────────────────────────────────────────

async function fetchSodimacPrice(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "es-CL,es;q=0.9",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Sodimac embebe el precio como "price":"NNNNN" en el HTML
    const match = html.match(/"price":"(\d+)"/);
    if (match) return parseInt(match[1], 10); // precio c/IVA

    return null;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function pct(a: number, b: number) {
  return (((b - a) / a) * 100).toFixed(1);
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const materials = await prisma.materialCatalog.findMany({
    where: { referenceLink: { contains: "sodimac" }, isProvision: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true, netPrice: true, referenceLink: true },
  });

  console.log(`\n📦 ${materials.length} materiales con link Sodimac`);
  console.log(APPLY ? "⚡ MODO APLICAR — se actualizará la DB" : "👁  MODO REVISIÓN — solo muestra cambios (--apply para guardar)\n");

  let updated = 0;
  let noChange = 0;
  let failed = 0;
  const changes: { name: string; old: number; newNet: number; diff: string }[] = [];

  for (let i = 0; i < materials.length; i++) {
    const mat = materials[i];
    process.stdout.write(`[${i + 1}/${materials.length}] ${mat.name.slice(0, 50).padEnd(50)} `);

    const priceIva = await fetchSodimacPrice(mat.referenceLink!);

    if (!priceIva) {
      console.log("❌ no encontrado");
      failed++;
      await sleep(DELAY_MS);
      continue;
    }

    const newNet = Math.round(priceIva / 1.19);
    const diff = Math.abs(newNet - mat.netPrice);
    const diffPct = Math.abs(parseFloat(pct(mat.netPrice, newNet)));

    if (diff < 10) {
      // Diferencia de menos de $10 neto → igual
      console.log(`✓ sin cambio  ($${mat.netPrice.toLocaleString("es-CL")} neto)`);
      noChange++;
    } else {
      const arrow = newNet > mat.netPrice ? "📈" : "📉";
      console.log(
        `${arrow} $${mat.netPrice.toLocaleString("es-CL")} → $${newNet.toLocaleString("es-CL")} neto  (${pct(mat.netPrice, newNet)}%)`
      );
      changes.push({ name: mat.name, old: mat.netPrice, newNet, diff: pct(mat.netPrice, newNet) });

      if (APPLY) {
        await prisma.materialCatalog.update({
          where: { id: mat.id },
          data: {
            netPrice: newNet,
            lastUpdated: new Date(),
            lastResearchAt: new Date(),
          },
        });
        // Guardar historial
        await prisma.materialPriceHistory.create({
          data: {
            materialId: mat.id,
            store: "sodimac",
            price: priceIva,
          },
        });
        updated++;
      }
    }

    await sleep(DELAY_MS);
  }

  // ── Resumen ──
  console.log("\n" + "─".repeat(70));
  console.log(`✅ Sin cambio:     ${noChange}`);
  console.log(`🔄 Con cambio:     ${changes.length}`);
  console.log(`❌ No encontrado:  ${failed}`);
  if (APPLY) console.log(`💾 Actualizados:   ${updated}`);

  if (changes.length > 0) {
    console.log("\n📋 Materiales con precio diferente:");
    // Ordenar por diferencia % absoluta
    changes
      .sort((a, b) => Math.abs(parseFloat(b.diff)) - Math.abs(parseFloat(a.diff)))
      .forEach((c) => {
        const arrow = parseFloat(c.diff) > 0 ? "📈" : "📉";
        console.log(
          `  ${arrow} ${c.name.slice(0, 45).padEnd(45)} ${c.diff.padStart(7)}%  ($${c.old.toLocaleString("es-CL")} → $${c.newNet.toLocaleString("es-CL")})`
        );
      });

    if (!APPLY) {
      console.log("\n💡 Para aplicar los cambios: npx tsx scripts/refresh-prices.ts --apply");
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
