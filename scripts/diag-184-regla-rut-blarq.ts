// Pendiente 184 — la regla "NICOLAS CUEVAS OSSANDON" está guardada con el RUT
// de BLARQ (77270733-9). ¿A qué facturas alcanza y cuáles pudo tocar?
// Solo lectura. Uso: npx tsx scripts/diag-184-regla-rut-blarq.ts <ruta-env>
import fs from "fs";
import { PrismaClient } from "@prisma/client";
const url = fs.readFileSync(process.argv[2], "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="))!.slice(13).replace(/^"|"$/g, "");
const prisma = new PrismaClient({ datasources: { db: { url } } });
const BLARQ = "77270733-9";
(async () => {
  try {
    console.log("host:", new URL(url).host);
    const rule = await prisma.invoiceCategorizationRule.findUnique({ where: { rutIssuer: BLARQ }, include: { category: { select: { name: true } }, project: { select: { name: true } } } });
    console.log("regla:", rule?.businessName, "→", rule?.category?.name, "/", rule?.project?.name ?? "sin proyecto", "· creada", rule?.createdAt.toISOString(), "· cambiada", rule?.updatedAt.toISOString(), "· hits", rule?.hits);
    const porTipo = await prisma.invoice.groupBy({ by: ["type"], where: { rutIssuer: BLARQ }, _count: true });
    console.log("facturas con rutIssuer = BLARQ:", porTipo.map((g) => `${g.type} ${g._count}`).join(", "));
    const ej = await prisma.invoice.findFirst({ where: { type: "emitida" }, orderBy: { issueDate: "desc" }, select: { rutIssuer: true, businessName: true, rutReceiver: true } as never });
    console.log("ejemplo emitida:", ej);
    const muebles = await prisma.invoice.findMany({
      where: { rutIssuer: BLARQ, category: { name: { not: "Obra" } } },
      orderBy: { issueDate: "asc" },
      select: { folioNumber: true, type: true, issueDate: true, createdAt: true, updatedAt: true, netAmount: true, businessName: true, conceptoCobro: true, montoObra: true, montoMuebles: true,
        category: { select: { name: true } }, project: { select: { name: true } } },
    });
    console.log(`\nfacturas BLARQ que NO están en Obra (${muebles.length}):`);
    for (const i of muebles)
      console.log(`  F${i.folioNumber} · ${i.issueDate.toISOString().slice(0, 10)} · creada ${i.createdAt.toISOString().slice(0, 10)} · ${i.category?.name} · concepto ${i.conceptoCobro ?? "—"} · ${i.project?.name ?? "sin obra"} · ${i.businessName} · neto ${Math.round(i.netAmount).toLocaleString("es-CL")}${i.montoObra != null || i.montoMuebles != null ? " · desglose" : ""}`);
    const sinCat = await prisma.invoice.count({ where: { rutIssuer: BLARQ, categoryId: null } });
    console.log("\nemitidas BLARQ sin categoría:", sinCat);
  } finally {
    await prisma.$disconnect();
  }
})();
