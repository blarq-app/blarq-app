import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const project = await prisma.project.findFirst({
  where: { name: { contains: "Lefevre" } },
});
if (!project) throw new Error("Project not found");
console.log("Project:", project.name, "current ufReference:", project.ufReference);

await prisma.project.update({
  where: { id: project.id },
  data: { ufReference: 39722 },
});
console.log("✓ Set ufReference = 39722");
await prisma.$disconnect();
