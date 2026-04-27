// Carga 4 facturas de prueba contra el proyecto Lefevre para que el dashboard
// "Estado de Resultados" muestre data real. Idempotente: limpia y recrea.
import { prisma } from "../src/lib/prisma";

async function main() {
  const projectId = "cmnx59uvq0000rty9ouec5i25";

  // Limpiar facturas previas de Lefevre (sólo las manuales de prueba)
  await prisma.invoice.deleteMany({
    where: { projectId, origin: "manual" },
  });

  const cats = await prisma.costCategory.findMany({
    where: { parentId: null },
    select: { id: true, name: true },
  });
  const byName = new Map(cats.map((c) => [c.name, c.id]));

  const invoices: Array<Parameters<typeof prisma.invoice.create>[0]["data"]> = [
    // Cobro al cliente — anticipo 40% (referencial)
    {
      projectId,
      type: "emitida",
      folioNumber: "1024",
      rutIssuer: "76.123.456-7",
      businessName: "BLARQ SpA",
      issueDate: new Date("2026-04-10"),
      netAmount: 8_403_361,
      iva: Math.round(8_403_361 * 0.19),
      totalAmount: 10_000_000,
      status: "pagada",
      origin: "manual",
      notes: "Anticipo 40% Cristian Lefevre",
    },
    // Materiales — Sodimac
    {
      projectId,
      categoryId: byName.get("Materiales") ?? null,
      type: "recibida",
      folioNumber: "8835421",
      rutIssuer: "81.201.000-K",
      businessName: "Sodimac S.A.",
      issueDate: new Date("2026-04-12"),
      netAmount: 1_848_739,
      iva: Math.round(1_848_739 * 0.19),
      totalAmount: 2_200_000,
      status: "pagada",
      origin: "manual",
      notes: "Pavimentos + revestimientos cocina/baños",
    },
    // Subcontrato eléctrico
    {
      projectId,
      categoryId: byName.get("Subcontrato") ?? null,
      type: "recibida",
      folioNumber: "421",
      rutIssuer: "12.345.678-9",
      businessName: "Instalaciones Eléctricas RM Ltda.",
      issueDate: new Date("2026-04-15"),
      netAmount: 882_352,
      iva: Math.round(882_352 * 0.19),
      totalAmount: 1_050_000,
      status: "pendiente",
      origin: "manual",
      notes: "Cambio de módulo eléctrico + recableo cocina",
    },
    // Arriendo de herramientas
    {
      projectId,
      categoryId: byName.get("Herramientas") ?? null,
      type: "recibida",
      folioNumber: "55891",
      rutIssuer: "76.987.654-3",
      businessName: "Andamios y Maquinarias Andrade",
      issueDate: new Date("2026-04-20"),
      netAmount: 252_100,
      iva: Math.round(252_100 * 0.19),
      totalAmount: 300_000,
      status: "pendiente",
      origin: "manual",
      notes: "Andamio 2 cuerpos × 3 semanas",
    },
  ];

  for (const data of invoices) {
    await prisma.invoice.create({ data });
  }

  console.log(`Seeded ${invoices.length} facturas para Lefevre.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
