// Migración idempotente: agrega BankMovement.projectId (+ FK ON DELETE SET NULL
// ON UPDATE CASCADE + índice) replicando EXACTO lo que `prisma db push` creó en
// dev. Idempotente: re-correrlo no rompe ni duplica nada (ADD COLUMN IF NOT
// EXISTS / guard de pg_constraint / CREATE INDEX IF NOT EXISTS).
//
// Uso:  npx tsx scripts/migrate-bankmovement-projectid.ts [.env.prod]
// Default apunta a .env.prod. Para probar en dev: pasar ".env".
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

const ENV_PATH = process.argv[2] ?? ".env.prod";
const parsed = config({ path: ENV_PATH }).parsed ?? {};
// Para DDL preferimos la conexión directa (no pooled) si existe.
const url = parsed.DIRECT_URL || parsed.DATABASE_URL;
if (!url) {
  console.error(`No encontré DATABASE_URL/DIRECT_URL en ${ENV_PATH}`);
  process.exit(1);
}
const host = url.match(/@([^/:]+)/)?.[1] ?? "?";
console.log(`Conectando a: ${host}  (env: ${ENV_PATH})`);

const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "BankMovement" ADD COLUMN IF NOT EXISTS "projectId" TEXT;`
  );
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BankMovement_projectId_fkey') THEN
        ALTER TABLE "BankMovement"
          ADD CONSTRAINT "BankMovement_projectId_fkey"
          FOREIGN KEY ("projectId") REFERENCES "Project"("id")
          ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
    END $$;`);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "BankMovement_projectId_idx" ON "BankMovement"("projectId");`
  );

  // Verificación post-migración
  const col = await prisma.$queryRawUnsafe(
    `SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_name='BankMovement' AND column_name='projectId';`
  );
  const fk = await prisma.$queryRawUnsafe(
    `SELECT conname, confdeltype, confupdtype FROM pg_constraint WHERE conname='BankMovement_projectId_fkey';`
  );
  const idx = await prisma.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE indexname='BankMovement_projectId_idx';`
  );
  const total = await prisma.bankMovement.count();
  const conObra = await prisma.bankMovement.count({ where: { NOT: { projectId: null } } });
  console.log("Columna:", JSON.stringify(col), "(esperado is_nullable=YES)");
  console.log("FK:", JSON.stringify(fk), "(esperado confdeltype=n, confupdtype=c)");
  console.log("Índice:", JSON.stringify(idx));
  console.log(`Movimientos: ${total} · con obra asignada: ${conObra} (esperado 0 en prod)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
