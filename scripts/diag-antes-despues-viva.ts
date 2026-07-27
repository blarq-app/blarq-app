// Foto SOLO LECTURA de la base viva para comparar antes y después del SQL
// aditivo: cuántas filas hay en las tablas que se tocan y qué columnas tienen.
// Si algo que ya existía desaparece, esto lo canta.
// Uso: npx tsx scripts/diag-antes-despues-viva.ts <ruta-env>
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2] ?? ".env.prod";
const url = readFileSync(envPath, "utf8").match(
  /DATABASE_URL\s*=\s*"?([^"\n]+)"?/
)![1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function columnas(tabla: string): Promise<string[]> {
  const filas = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY column_name`,
    tabla
  );
  return filas.map((f) => f.column_name);
}

async function cuenta(tabla: string): Promise<number | string> {
  try {
    const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM "${tabla}"`
    );
    return Number(r[0].n);
  } catch {
    return "(la tabla no existe)";
  }
}

async function main() {
  console.log(`=== FOTO DE LA BASE ===`);
  console.log(`ENV: ${envPath} | HOST: ${host}\n`);
  for (const t of ["ObraItem", "EstadoPagoItem", "ObraChapter", "BudgetVersion"]) {
    console.log(`${t}: ${await cuenta(t)} filas`);
    const cols = await columnas(t);
    console.log(`   columnas (${cols.length}): ${cols.join(", ") || "(la tabla no existe)"}\n`);
  }
}

main()
  .catch((e) => console.error("ERROR:", e.message))
  .finally(() => prisma.$disconnect());
