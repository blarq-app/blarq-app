// Pendiente 184 — mapa de las categorías "Mueble" / "Muebles" antes de
// juntarlas. Solo lectura. Uso:
//   npx tsx scripts/diag-184-categorias-mueble.ts .env.local
import fs from "fs";
import { PrismaClient } from "@prisma/client";
const url = fs.readFileSync(process.argv[2], "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="))!.slice(13).replace(/^"|"$/g, "");
const prisma = new PrismaClient({ datasources: { db: { url } } });
(async () => {
  console.log("host:", new URL(url).host);
  const cats = await prisma.costCategory.findMany({
    where: { OR: [{ name: { contains: "mueble", mode: "insensitive" } }, { parent: { name: { contains: "mueble", mode: "insensitive" } } }] },
    include: { parent: { select: { name: true } }, _count: { select: { invoices: true, invoiceRules: true, pendingTags: true, children: true } } },
  });
  for (const c of cats) {
    const porTipo = await prisma.invoice.groupBy({ by: ["type"], where: { categoryId: c.id }, _count: true, _sum: { netAmount: true } });
    console.log(`\n${c.parent ? c.parent.name + " > " : ""}${c.name}  [id ${c.id}]  appliesTo=${c.appliesTo} type=${c.type} sort=${c.sortOrder}`);
    console.log(`   facturas ${c._count.invoices} · reglas ${c._count.invoiceRules} · etiquetas ${c._count.pendingTags} · hijas ${c._count.children}`);
    porTipo.forEach((g) => console.log(`   ${g.type}: ${g._count} · neto ${Math.round(g._sum.netAmount ?? 0).toLocaleString("es-CL")}`));
    const reglas = await prisma.invoiceCategorizationRule.findMany({ where: { categoryId: c.id }, select: { businessName: true } });
    if (reglas.length) console.log(`   reglas de: ${reglas.map((r) => r.businessName).join(", ")}`);
    const prov = await prisma.invoice.groupBy({ by: ["businessName"], where: { categoryId: c.id }, _count: true, orderBy: { _count: { businessName: "desc" } }, take: 8 });
    console.log(`   proveedores: ${prov.map((p) => `${p.businessName} ${p._count}`).join(" · ")}`);
  }
  await prisma.$disconnect();
})();
