// Pendiente 184 — pasa la regla de categoría de Sodimac de Herramientas a
// Materiales (pedido de MJ, 2026-09-24). Toca SOLO la regla: ninguna factura.
// La categoría destino es la que tiene la mayoría de sus facturas.
// Uso:
//   npx tsx scripts/aplicar-184-regla-sodimac.ts <ruta-env>            (prueba)
//   npx tsx scripts/aplicar-184-regla-sodimac.ts <ruta-env> --apply    (escribe)
import fs from "fs";
import { PrismaClient } from "@prisma/client";
const url = fs.readFileSync(process.argv[2], "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="))!.slice(13).replace(/^"|"$/g, "");
const prisma = new PrismaClient({ datasources: { db: { url } } });
const APPLY = process.argv.includes("--apply");
const SODIMAC = "96792430-K";

(async () => {
  try {
    console.log("host:", new URL(url).host, APPLY ? "· APLICANDO" : "· prueba (sin escribir)");
    const rule = await prisma.invoiceCategorizationRule.findUnique({
      where: { rutIssuer: SODIMAC },
      include: { category: { select: { name: true } } },
    });
    if (!rule) throw new Error("Sodimac no tiene regla");
    const g = await prisma.invoice.groupBy({
      by: ["categoryId"],
      where: { rutIssuer: SODIMAC, categoryId: { not: null } },
      _count: true,
      orderBy: { _count: { categoryId: "desc" } },
    });
    const destino = await prisma.costCategory.findUnique({ where: { id: g[0].categoryId! }, include: { parent: { select: { name: true } } } });
    if (destino?.name !== "Materiales") throw new Error(`La mayoritaria no es Materiales: ${destino?.name}`);
    console.log(`regla hoy: ${rule.category?.name} · proyecto ${rule.projectId ?? "—"}`);
    console.log(`destino:   ${destino.parent ? destino.parent.name + " > " : ""}${destino.name} (${g[0]._count} facturas) [${destino.id}]`);
    if (rule.categoryId === destino.id) return console.log("Ya está en Materiales. Nada que hacer.");
    if (!APPLY) return console.log("Prueba: no se escribió nada.");
    await prisma.invoiceCategorizationRule.update({ where: { id: rule.id }, data: { categoryId: destino.id } });
    const post = await prisma.invoiceCategorizationRule.findUnique({ where: { id: rule.id }, include: { category: { select: { name: true } } } });
    console.log(`listo: regla de Sodimac → ${post?.category?.name}`);
  } finally {
    await prisma.$disconnect();
  }
})();
