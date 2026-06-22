/**
 * Carga al catálogo (HerrajeCatalog) la tanda HBT — los herrajes de la
 * cotización BRUNE/HBT (Comercial Habitat, distribuidor Blum) que usa MJ.
 *
 * Lee scripts/herrajes-hbt-borrador.json (armado desde la cotización PDF +
 * enriquecido con foto/link de hbt.cl, Magento). COSTO = el precio de la
 * cotización (lo que MJ realmente paga, con su descuento), NO el público de
 * hbt.cl. El precio a cliente lo deriva la app (costo × 1,2).
 *
 * Recarga LIMPIA de HBT: borra HerrajeCatalog supplier="HBT" y reinserta.
 * Idempotente. Corre contra la BD del DATABASE_URL (dev o prod según se pase).
 *
 *   npx tsx scripts/cargar-herrajes-hbt.ts          (dry-run)
 *   npx tsx scripts/cargar-herrajes-hbt.ts --apply  (escribe en la BD del env)
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Draft = {
  name: string;
  measure: string | null;
  finish: string | null;
  cost: number;
  category: string;
  subgroup: string;
  sku: string;
  _match: { name: string; link: string; img: string | null } | null;
};

async function main() {
  const apply = process.argv.includes("--apply");
  const rows: Draft[] = JSON.parse(
    readFileSync(path.join(__dirname, "herrajes-hbt-borrador.json"), "utf8"),
  );

  const host = (process.env.DATABASE_URL || "").match(/ep-[a-z0-9-]+/)?.[0];
  console.log(`BD: ${host} · HBT a cargar: ${rows.length}`);

  if (!apply) {
    for (const r of rows) {
      const cliente = Math.round(r.cost * 1.2);
      console.log(
        `  [${r.category}/${r.subgroup}] ${r.name} ${r.measure ?? ""} ${r.finish ?? ""} — costo $${r.cost.toLocaleString("es-CL")} → cliente $${cliente.toLocaleString("es-CL")} ${r._match?.img ? "[foto]" : "[sin foto]"}`,
      );
    }
    console.log("\n(dry-run) corré con --apply para escribir.");
    return;
  }

  const before = await prisma.herrajeCatalog.count({ where: { supplier: "HBT" } });
  await prisma.herrajeCatalog.deleteMany({ where: { supplier: "HBT" } });
  await prisma.herrajeCatalog.createMany({
    data: rows.map((r, i) => ({
      name: r.name,
      // Guardamos el nombre exacto de hbt.cl como detalle (referencia), si hubo match.
      detail: r._match?.name ?? null,
      supplier: "HBT",
      category: r.category,
      subgroup: r.subgroup,
      measure: r.measure,
      finish: r.finish,
      // Marca: los sistemas Blum (Merivobox/Cliptop/Movento/Spacetower/Blumotion)
      // se etiquetan "Blum"; el resto (Libell, basureros) queda sin marca.
      brand: /merivobox|cliptop|movento|spacetower|blumotion/i.test(r.name)
        ? "Blum"
        : null,
      sku: r.sku,
      referenceLink: r._match?.link ?? null,
      imageUrl: r._match?.img ?? null,
      costNet: r.cost,
      sortOrder: i,
      lastPriceCheck: new Date(),
    })),
  });
  const after = await prisma.herrajeCatalog.count({ where: { supplier: "HBT" } });
  console.log(`HBT: ${before} → ${after} herrajes en el catálogo.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
