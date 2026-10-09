/**
 * Aplica prisma/sql/156-aviso-gl-descartado.sql (la columna
 * `avisoGLDescartado` de ObraItem) a la base cuyo DATABASE_URL está en el
 * archivo .env que se pasa. Idempotente: correrlo dos veces no hace nada la
 * segunda.
 *
 *   npx tsx scripts/aplicar-156-columna.ts <ruta-env>
 *
 * Contra la VIVA (ep-shy-morning) solo con OK explícito de MJ (§4.7), y ANTES
 * de mergear: el código nuevo lee la columna. NO usa `prisma db push`: contra
 * la viva ya borró datos una vez (ver la nota de drift en la memoria).
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import path from "path";

const envPath = process.argv[2];
if (!envPath) throw new Error("uso: npx tsx scripts/aplicar-156-columna.ts <ruta-env>");
const raw = readFileSync(envPath, "utf8");
const m = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
if (!m) throw new Error("sin DATABASE_URL en " + envPath);
const url = m[1].trim();
const host = url.match(/ep-[a-z-]+|localhost/)?.[0] ?? "?";

const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  console.log("Base:", host);
  const sql = readFileSync(path.join(__dirname, "..", "prisma", "sql", "156-aviso-gl-descartado.sql"), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .trim();
  if (process.argv.includes("--mostrar")) {
    console.log(sql);
    return;
  }
  await prisma.$executeRawUnsafe(sql);
  const cols = await prisma.$queryRaw<{ column_name: string; data_type: string }[]>`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'ObraItem' AND column_name = 'avisoGLDescartado'`;
  console.log("columna:", cols.length === 1 ? `OK (${cols[0].data_type})` : "FALTA");
  const conValor = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM "ObraItem" WHERE "avisoGLDescartado" IS NOT NULL`;
  console.log("partidas con el aviso descartado:", Number(conValor[0].n), "(recién aplicado debe ser 0)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
