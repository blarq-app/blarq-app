/**
 * Carga la tanda aprobada de herrajes DPH al catálogo (HerrajeCatalog).
 *
 * Lee scripts/herrajes-dph-aprobado.json (generado desde los products.json de
 * dph.cl con la selección que aprobó MJ: cajones blancos interior/frente madera,
 * correderas ocultas extensión total todas las medidas, bisagras cierre suave
 * por subgrupo sin las NKO ni las "con retén", despensas laterales blancas).
 *
 * Es una recarga LIMPIA de DPH: borra los HerrajeCatalog de supplier="DPH" y
 * vuelve a insertarlos. Idempotente. Corre contra la BD del .env (dev).
 *
 *   npx tsx scripts/cargar-herrajes-dph.ts          (dry-run, solo muestra)
 *   npx tsx scripts/cargar-herrajes-dph.ts --apply  (escribe)
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Row = {
  name: string;
  supplier: string;
  category: string;
  subgroup: string | null;
  measure: string | null;
  finish: string | null;
  brand: string | null;
  sku: string | null;
  referenceLink: string | null;
  imageUrl: string | null;
  costNet: number;
};

async function main() {
  const apply = process.argv.includes("--apply");
  const file = path.join(__dirname, "herrajes-dph-aprobado.json");
  const rows: Row[] = JSON.parse(readFileSync(file, "utf8"));

  // Orden: por categoría, subgrupo y medida, para que el sortOrder inicial deje
  // las medidas en orden ascendente dentro de cada producto.
  const medNum = (m: string | null) => (m ? parseInt(m.replace(/\D/g, ""), 10) || 0 : 0);
  rows.sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      (a.subgroup || "").localeCompare(b.subgroup || "") ||
      a.name.localeCompare(b.name) ||
      medNum(a.measure) - medNum(b.measure),
  );

  console.log(`Filas a cargar (DPH): ${rows.length}`);
  if (!apply) {
    console.log("\n(dry-run) muestra de las primeras 5:");
    for (const r of rows.slice(0, 5)) {
      const cliente = Math.round(r.costNet * 1.2);
      console.log(
        `  [${r.category}/${r.subgroup}] ${r.name} ${r.measure ?? ""} ${r.finish ?? ""} — costo $${r.costNet.toLocaleString("es-CL")} → cliente $${cliente.toLocaleString("es-CL")} (sku ${r.sku})`,
      );
    }
    console.log("\nVolvé a correr con --apply para escribir en la BD del .env.");
    return;
  }

  const before = await prisma.herrajeCatalog.count({ where: { supplier: "DPH" } });
  await prisma.herrajeCatalog.deleteMany({ where: { supplier: "DPH" } });
  await prisma.herrajeCatalog.createMany({
    data: rows.map((r, i) => ({
      name: r.name,
      supplier: r.supplier,
      category: r.category,
      subgroup: r.subgroup,
      measure: r.measure,
      finish: r.finish,
      brand: r.brand,
      sku: r.sku,
      referenceLink: r.referenceLink,
      imageUrl: r.imageUrl,
      costNet: r.costNet,
      sortOrder: i,
      lastPriceCheck: new Date(),
    })),
  });
  const after = await prisma.herrajeCatalog.count({ where: { supplier: "DPH" } });
  console.log(`DPH: ${before} → ${after} herrajes en el catálogo.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
