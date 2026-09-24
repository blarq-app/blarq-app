// Pendiente 184 — mide, por cada regla de categoría, cómo están repartidas
// de verdad las facturas del proveedor. Solo lectura. Uso:
//   npx tsx scripts/diag-184-reglas-vs-facturas.ts .env.prod
import fs from "fs";
import { PrismaClient } from "@prisma/client";
const url = fs.readFileSync(process.argv[2], "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="))!.replace(/^DATABASE_URL=/, "").replace(/^"|"$/g, "");
const prisma = new PrismaClient({ datasources: { db: { url } } });
async function main() {
  console.log("host:", new URL(url).host);
  const p64 = await prisma.project.findFirst({ where: { number: 64 }, select: { name: true } }).catch(() => null);
  console.log("marcador #64:", p64?.name);
  const cats = new Map((await prisma.costCategory.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const reglas = await prisma.invoiceCategorizationRule.findMany({ where: { categoryId: { not: null } } });
  let mixtas = 0, noCalza = 0, mixtasConNull = 0;
  const filas: string[] = [];
  for (const r of reglas) {
    const where = r.rutIssuer ? { rutIssuer: r.rutIssuer } : r.providerName ? { rutIssuer: null, businessName: r.providerName } : null;
    if (!where) continue;
    const g = await prisma.invoice.groupBy({ by: ["categoryId"], where, _count: true });
    const conCat = g.filter((x) => x.categoryId).sort((a, b) => b._count - a._count);
    const total = conCat.reduce((a, x) => a + x._count, 0);
    if (g.length > 1) mixtasConNull++;
    if (conCat.length >= 2) mixtas++;
    const mayor = conCat[0];
    const calza = !mayor || mayor.categoryId === r.categoryId;
    if (!calza) noCalza++;
    if (conCat.length >= 2 || !calza)
      filas.push(`${calza ? "   " : "!! "}${(r.businessName ?? r.providerName ?? r.rutIssuer ?? "").slice(0, 30).padEnd(31)} regla=${cats.get(r.categoryId!)} · ${conCat.map((x) => `${cats.get(x.categoryId!)} ${x._count}`).join(", ")} (de ${total})`);
  }
  console.log(`reglas con categoría: ${reglas.length}`);
  console.log(`con facturas en 2+ categorías (ignorando sin categoría): ${mixtas}`);
  console.log(`contando "sin categoría" como una más: ${mixtasConNull}`);
  console.log(`regla ≠ mayoritaria: ${noCalza}\n`);
  filas.sort().forEach((f) => console.log(f));
}
main().catch((e) => console.error(String(e).slice(0, 500))).finally(() => prisma.$disconnect());
