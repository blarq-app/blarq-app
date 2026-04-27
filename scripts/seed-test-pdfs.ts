// Crea presupuestos de prueba (Muebles + Artefactos) para Lefevre y devuelve
// sus IDs. Idempotente: si ya existen V1 muebles / V1 artefactos, los recrea.
import { prisma } from "../src/lib/prisma";

async function main() {
  const projectId = "cmnx59uvq0000rty9ouec5i25";

  // Limpiar V1 muebles/artefactos existentes (test fixtures)
  await prisma.budgetVersion.deleteMany({
    where: {
      projectId,
      type: { in: ["muebles", "artefactos"] },
      version: "V1",
    },
  });

  // Muebles
  const muebles = await prisma.budgetVersion.create({
    data: {
      projectId,
      version: "V1",
      type: "muebles",
      status: "borrador",
      observations: null,
    },
  });
  await prisma.muebleItem.createMany({
    data: [
      {
        budgetVersionId: muebles.id,
        subcategory: "mueble",
        description: "MUEBLE BASE COCINA — Melamina blanca 18mm tapacanto",
        costDistributor: 800000,
        utilityPercentage: 25,
        clientPrice: 1000000,
        clientPriceIva: 1190000,
        sortOrder: 0,
      },
      {
        budgetVersionId: muebles.id,
        subcategory: "mueble",
        description: "MUEBLE MURAL COCINA — Melamina blanca 18mm tapacanto",
        costDistributor: 600000,
        utilityPercentage: 25,
        clientPrice: 750000,
        clientPriceIva: 892500,
        sortOrder: 1,
      },
      {
        budgetVersionId: muebles.id,
        subcategory: "herraje",
        description: "Bisagras cierre suave + correderas ocultas",
        costDistributor: 200000,
        utilityPercentage: 25,
        clientPrice: 250000,
        clientPriceIva: 297500,
        sortOrder: 2,
      },
      {
        budgetVersionId: muebles.id,
        subcategory: "cubierta",
        description: "Cubierta porcelanato ultracompacto 12mm",
        costDistributor: 480000,
        utilityPercentage: 25,
        clientPrice: 600000,
        clientPriceIva: 714000,
        sortOrder: 3,
      },
    ],
  });

  // Artefactos
  const artefactos = await prisma.budgetVersion.create({
    data: {
      projectId,
      version: "V1",
      type: "artefactos",
      status: "borrador",
      observations: null,
    },
  });
  await prisma.artefactoItem.createMany({
    data: [
      {
        budgetVersionId: artefactos.id,
        room: "bano_principal",
        subcategory: "wc",
        name: "WC ACOPLADO BLANCO",
        brand: "KLIPEN",
        quantity: 1,
        listPrice: 180000,
        discountPercent: 15,
        clientPrice: 153000,
        sortOrder: 0,
      },
      {
        budgetVersionId: artefactos.id,
        room: "bano_principal",
        subcategory: "vanitorio",
        name: "MUEBLE VANITORIO 60CM",
        brand: "MK",
        quantity: 1,
        listPrice: 320000,
        discountPercent: 10,
        clientPrice: 288000,
        sortOrder: 1,
      },
      {
        budgetVersionId: artefactos.id,
        room: "bano_secundario",
        subcategory: "wc",
        name: "WC ACOPLADO BLANCO",
        brand: "KLIPEN",
        quantity: 1,
        listPrice: 180000,
        discountPercent: 15,
        clientPrice: 153000,
        sortOrder: 2,
      },
      {
        budgetVersionId: artefactos.id,
        room: "cocina",
        subcategory: "griferia",
        name: "GRIFERIA LAVAPLATOS",
        brand: "FDV",
        quantity: 1,
        listPrice: 140000,
        discountPercent: 20,
        clientPrice: 112000,
        sortOrder: 3,
      },
    ],
  });

  console.log(`Muebles V1 creado: ${muebles.id}`);
  console.log(`Artefactos V1 creado: ${artefactos.id}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
