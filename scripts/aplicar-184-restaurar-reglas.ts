// Pendiente 184 — segunda vuelta de MJ (2026-09-24) sobre las reglas que
// aplicar-184-recategorizar.ts había borrado:
//   - Comercial K: NO borrar, dejar en Materiales ("yo le digo a Telegram o
//     cambio en la app si es otra cosa, pero no cambia la regla").
//   - Cencosud: NO borrar, "extras está bien" → vuelve tal cual estaba.
// Recrea las dos desde el respaldo (mismo id y fecha de creación). NO completa
// facturas viejas sin categoría: solo deja la regla para las que lleguen.
//
// Uso:
//   npx tsx scripts/aplicar-184-restaurar-reglas.ts <ruta-env> <respaldo.json>            (prueba)
//   npx tsx scripts/aplicar-184-restaurar-reglas.ts <ruta-env> <respaldo.json> --apply    (escribe)
import fs from "fs";
import { PrismaClient } from "@prisma/client";

const [envPath, respaldoPath] = process.argv.slice(2);
const APPLY = process.argv.includes("--apply");
const url = fs.readFileSync(envPath, "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="))!.slice(13).replace(/^"|"$/g, "");
const prisma = new PrismaClient({ datasources: { db: { url } } });

const RESTAURAR: { rut: string; nombre: string; categoria: "igual" | string }[] = [
  { rut: "77137860-9", nombre: "Comercial K", categoria: "Materiales" },
  { rut: "81201000-K", nombre: "Cencosud", categoria: "igual" },
];

(async () => {
  try {
    console.log("host:", new URL(url).host, APPLY ? "· APLICANDO" : "· prueba (sin escribir)");
    const respaldo = JSON.parse(fs.readFileSync(respaldoPath, "utf8"));
    const materiales = await prisma.costCategory.findMany({ where: { name: "Materiales", parentId: null } });
    if (materiales.length !== 1) throw new Error(`"Materiales" madre: ${materiales.length}`);

    const crear = [];
    for (const r of RESTAURAR) {
      const antes = respaldo.reglas.find((x: { rutIssuer: string }) => x.rutIssuer === r.rut);
      if (!antes) throw new Error(`${r.nombre}: no está en el respaldo`);
      const ya = await prisma.invoiceCategorizationRule.findUnique({ where: { rutIssuer: r.rut } });
      if (ya) throw new Error(`${r.nombre}: ya tiene regla, no se toca`);
      const categoryId = r.categoria === "igual" ? antes.categoryId : materiales[0].id;
      const cat = await prisma.costCategory.findUnique({ where: { id: categoryId }, select: { name: true } });
      const sinCategoria = await prisma.invoice.count({ where: { rutIssuer: r.rut, categoryId: null } });
      console.log(`  ${r.nombre}: se recrea con ${cat?.name} (facturas suyas sin categoría hoy: ${sinCategoria}, no se tocan)`);
      crear.push({
        id: antes.id,
        rutIssuer: antes.rutIssuer,
        providerName: antes.providerName,
        businessName: antes.businessName,
        categoryId,
        projectId: antes.projectId,
        hits: r.categoria === "igual" ? antes.hits : 0,
        createdAt: new Date(antes.createdAt),
      });
    }
    if (!APPLY) return console.log("Prueba: no se escribió nada.");
    await prisma.$transaction(crear.map((data) => prisma.invoiceCategorizationRule.create({ data })));
    console.log("listo.");
  } finally {
    await prisma.$disconnect();
  }
})();
