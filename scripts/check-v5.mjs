import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const b = await prisma.budgetVersion.findFirst({
  where: { version: "V5", project: { name: { contains: "Lefevre" } } },
});
console.log("date:", b.date, "version:", b.version, "status:", b.status);
await prisma.$disconnect();
