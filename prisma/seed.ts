import { PrismaClient } from "@prisma/client";
import { hashSync } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const mj = await prisma.user.upsert({
    where: { email: "mjblanco@blarq.cl" },
    update: {},
    create: {
      name: "María José Blanco",
      email: "mjblanco@blarq.cl",
      password: hashSync("blarq2026", 10),
      role: "admin",
    },
  });

  const jt = await prisma.user.upsert({
    where: { email: "jtlarrain@blarq.cl" },
    update: {},
    create: {
      name: "José Tomás Larraín",
      email: "jtlarrain@blarq.cl",
      password: hashSync("blarq2026", 10),
      role: "admin",
    },
  });

  console.log("Usuarios creados:", mj.name, jt.name);

  const categories = [
    { name: "Materiales", type: "directo", sortOrder: 1, children: [] as any[] },
    { name: "Mano de obra", type: "directo", sortOrder: 2, children: [] as any[] },
    { name: "Herramientas", type: "directo", sortOrder: 3, children: [] as any[] },
    { name: "Subcontrato", type: "directo", sortOrder: 4, children: [
      { name: "Ventanas", sortOrder: 1 },
      { name: "Flete / Retiro escombros", sortOrder: 2 },
    ]},
    { name: "Pérdidas", type: "directo", sortOrder: 5, children: [] as any[] },
    { name: "Muebles", type: "directo", sortOrder: 6, children: [
      { name: "Mueble", sortOrder: 1 },
      { name: "Cubiertas", sortOrder: 2 },
      { name: "Herrajes", sortOrder: 3 },
    ]},
    { name: "Artefactos", type: "directo", sortOrder: 7, children: [
      { name: "Cocina", sortOrder: 1 },
      { name: "Baño", sortOrder: 2 },
      { name: "Iluminación", sortOrder: 3 },
    ]},
    { name: "Gastos generales", type: "indirecto", sortOrder: 8, children: [] as any[] },
    { name: "Gastos financieros", type: "indirecto", sortOrder: 9, children: [] as any[] },
    { name: "Auto - Combustible", type: "indirecto", sortOrder: 10, children: [] as any[] },
    { name: "Auto - Autopistas", type: "indirecto", sortOrder: 11, children: [] as any[] },
    { name: "Auto - Seguro", type: "indirecto", sortOrder: 12, children: [] as any[] },
  ];

  for (const cat of categories) {
    const parent = await prisma.costCategory.create({
      data: { name: cat.name, type: cat.type, sortOrder: cat.sortOrder },
    });
    console.log("Categoría:", cat.name);

    for (const child of cat.children) {
      await prisma.costCategory.create({
        data: { name: child.name, parentId: parent.id, type: cat.type, sortOrder: child.sortOrder },
      });
      console.log("  Sub:", child.name);
    }
  }

  console.log("\nSeed completado!");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
