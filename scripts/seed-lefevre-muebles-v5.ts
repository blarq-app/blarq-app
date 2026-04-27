// Carga los muebles V5 reales de Lefevre extraídos del PDF/Excel del usuario.
// Estructura jerárquica: capítulo → items → detalles de componentes.
// Idempotente: borra V1 muebles previo y recrea V1 limpio.
import { prisma } from "../src/lib/prisma";

async function main() {
  const projectId = "cmnx59uvq0000rty9ouec5i25";

  // Limpiar muebles previos del proyecto
  await prisma.budgetVersion.deleteMany({
    where: { projectId, type: "muebles" },
  });

  const budget = await prisma.budgetVersion.create({
    data: {
      projectId,
      version: "V1",
      type: "muebles",
      status: "borrador",
      observations: null,
    },
  });

  // ── Capítulo 1: MUEBLES DE COCINA ──
  const cap1 = await prisma.muebleChapter.create({
    data: {
      budgetVersionId: budget.id,
      chapterNumber: 1,
      name: "MUEBLES DE COCINA",
      sortOrder: 0,
    },
  });

  // 1.1 MUEBLES — qty 1, $8.882.524 (= 5.488.460 × 1.36 × 1.19)
  const muebles11 = await prisma.muebleItem.create({
    data: {
      budgetVersionId: budget.id,
      chapterId: cap1.id,
      itemNumber: "1.1",
      name: "MUEBLES",
      descriptionGeneral: "SEGÚN PLANOS ARQUITECTURA",
      quantity: 1,
      supplier: "ROBERTO",
      costDistributor: 5488460,
      utilityPercentage: 0.36,
      clientPriceNet: 5488460 * 1.36,
      clientPriceIva: 5488460 * 1.36 * 1.19,
      sortOrder: 0,
    },
  });
  const detalles11 = [
    { name: "CUERPO INTERIOR", material: "MELAMINA BLANCA 18MM, TAPACANTO PVC 0,4MM, TAPACANTO IDEM COLOR FRENTES" },
    { name: "TRASERA", material: "MELAMINA BLANCA 15MM" },
    { name: "FRENTE MUEBLE BASE", material: "MELAMINA MADERA CIPRÉS DORADO 18MM" },
    { name: "FRENTE MUEBLE MURAL", material: "MELAMINA ARCILLA VESTO" },
    { name: "ZOCALO", material: "TERCIADO MUEBLERIA REVESTIDO PORCELANATO EN OBRA" },
  ];
  for (let i = 0; i < detalles11.length; i++) {
    await prisma.muebleDetail.create({
      data: { itemId: muebles11.id, ...detalles11[i], sortOrder: i },
    });
  }

  // Quote activa de ROBERTO (la que va al PDF)
  await prisma.muebleQuote.create({
    data: {
      itemId: muebles11.id,
      supplier: "ROBERTO",
      costDistributor: 5488460,
      utilityPercentage: 0.36,
      clientPriceNet: 5488460 * 1.36,
      clientPriceIva: 5488460 * 1.36 * 1.19,
      isSelected: true,
      sortOrder: 0,
    },
  });
  // Cotizaciones alternativas (sacadas del Excel V5 hoja MUEBLES filas 31-32)
  const alternatives = [
    { supplier: "GEO", costDistributor: 6960000, utilityPercentage: 0.45, sortOrder: 1 },
    { supplier: "CARLOS", costDistributor: 6150000, utilityPercentage: 0.45, sortOrder: 2 },
  ];
  for (const a of alternatives) {
    await prisma.muebleQuote.create({
      data: {
        itemId: muebles11.id,
        supplier: a.supplier,
        costDistributor: a.costDistributor,
        utilityPercentage: a.utilityPercentage,
        clientPriceNet: a.costDistributor * (1 + a.utilityPercentage),
        clientPriceIva: a.costDistributor * (1 + a.utilityPercentage) * 1.19,
        isSelected: false,
        sortOrder: a.sortOrder,
      },
    });
  }

  // 1.2 HERRAJES — qty 1, $272.186 (= 182.982 × 1.25 × 1.19)
  const herrajes12 = await prisma.muebleItem.create({
    data: {
      budgetVersionId: budget.id,
      chapterId: cap1.id,
      itemNumber: "1.2",
      name: "HERRAJES",
      descriptionGeneral:
        "CORREDERA OCULTA CON CIERRE SUAVE, BISAGRAS CON CIERRE SUAVE",
      quantity: 1,
      supplier: "PROVELCAR",
      costDistributor: 182982,
      utilityPercentage: 0.25,
      clientPriceNet: 182982 * 1.25,
      clientPriceIva: 182982 * 1.25 * 1.19,
      sortOrder: 1,
    },
  });
  await prisma.muebleQuote.create({
    data: {
      itemId: herrajes12.id,
      supplier: "PROVELCAR",
      costDistributor: 182982,
      utilityPercentage: 0.25,
      clientPriceNet: 182982 * 1.25,
      clientPriceIva: 182982 * 1.25 * 1.19,
      isSelected: true,
      sortOrder: 0,
    },
  });

  // 1.3 CUBIERTAS — qty 1, $1.801.610 (= 1.211.166 × 1.25 × 1.19)
  const cubiertas13 = await prisma.muebleItem.create({
    data: {
      budgetVersionId: budget.id,
      chapterId: cap1.id,
      itemNumber: "1.3",
      name: "CUBIERTAS",
      descriptionGeneral: "CUARZO BLANCO MUBE",
      quantity: 1,
      supplier: "GIACOMO",
      costDistributor: 1211166.4,
      utilityPercentage: 0.25,
      clientPriceNet: 1211166.4 * 1.25,
      clientPriceIva: 1211166.4 * 1.25 * 1.19,
      sortOrder: 2,
    },
  });
  await prisma.muebleQuote.create({
    data: {
      itemId: cubiertas13.id,
      supplier: "GIACOMO",
      costDistributor: 1211166.4,
      utilityPercentage: 0.25,
      clientPriceNet: 1211166.4 * 1.25,
      clientPriceIva: 1211166.4 * 1.25 * 1.19,
      isSelected: true,
      sortOrder: 0,
    },
  });
  // Cubiertas: alternativas reales del Excel (filas 26-28)
  await prisma.muebleQuote.create({
    data: {
      itemId: cubiertas13.id,
      supplier: "GIACOMO (ULTRACOMPACTO LISO)",
      costDistributor: 1353000.36,
      utilityPercentage: 0.20,
      clientPriceNet: 1353000.36 * 1.20,
      clientPriceIva: 1353000.36 * 1.20 * 1.19,
      isSelected: false,
      sortOrder: 1,
    },
  });
  await prisma.muebleQuote.create({
    data: {
      itemId: cubiertas13.id,
      supplier: "GIACOMO (ULTRACOMPACTO VETA)",
      costDistributor: 1635871.46,
      utilityPercentage: 0.20,
      clientPriceNet: 1635871.46 * 1.20,
      clientPriceIva: 1635871.46 * 1.20 * 1.19,
      isSelected: false,
      sortOrder: 2,
    },
  });

  // Forma de pago muebles 60/30/10
  await prisma.paymentTerm.createMany({
    data: [
      { budgetVersionId: budget.id, stage: "Anticipo", percentage: 60, sortOrder: 0 },
      { budgetVersionId: budget.id, stage: "Inicio Instalación", percentage: 30, sortOrder: 1 },
      { budgetVersionId: budget.id, stage: "Saldo", percentage: 10, sortOrder: 2 },
    ],
  });

  console.log(`Muebles V1 Lefevre creado: ${budget.id}`);
  console.log("  1 capítulo, 3 items, 5 detalles bajo 1.1 MUEBLES");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
