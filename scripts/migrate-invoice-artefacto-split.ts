import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
// Migración idempotente: agrega Invoice.artefactoCocina/Sanitario/Iluminacion
// (Float nullable). NO usa db push (dev tiene tablas de otras sesiones que
// db push dropearía). Uso: npx tsx scripts/... [.env | .env.prod]
const ENV = process.argv[2] ?? ".env";
const parsed = config({ path: ENV }).parsed ?? {};
const url = parsed.DIRECT_URL || parsed.DATABASE_URL;
const host = url?.match(/@([^/:.]+)/)?.[1];
console.log(`Conectando a: ${host} (${ENV})`);
const prisma = new PrismaClient({ datasources: { db: { url } } });
async function main() {
  for (const col of ["artefactoCocina", "artefactoSanitario", "artefactoIluminacion"]) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "${col}" DOUBLE PRECISION;`);
  }
  const cols = await prisma.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_name='Invoice' AND column_name LIKE 'artefacto%';`);
  console.log("Columnas artefacto* en Invoice:", JSON.stringify(cols));
}
main().catch(e=>{console.error(e);process.exit(1)}).finally(()=>prisma.$disconnect());
