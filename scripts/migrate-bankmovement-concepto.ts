import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
const ENV = process.argv[2] ?? ".env";
const parsed = config({ path: ENV }).parsed ?? {};
const url = parsed.DIRECT_URL || parsed.DATABASE_URL;
console.log(`Conectando a: ${url?.match(/@([^/:.]+)/)?.[1]} (${ENV})`);
const prisma = new PrismaClient({ datasources: { db: { url } } });
async function main() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "BankMovement" ADD COLUMN IF NOT EXISTS "internalConcepto" TEXT;`);
  const c = await prisma.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_name='BankMovement' AND column_name='internalConcepto';`);
  console.log("Columna:", JSON.stringify(c));
}
main().catch(e=>{console.error(e);process.exit(1)}).finally(()=>prisma.$disconnect());
