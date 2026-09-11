/**
 * Aplica prisma/sql/177-mueble-alternativas.sql (la columna `alternativeOfId`
 * de MuebleItem) a la base cuyo DATABASE_URL está en el archivo .env que se
 * pasa. Idempotente: correrlo dos veces no hace nada la segunda.
 *
 *   npx tsx scripts/aplicar-177-columna.ts <ruta-env>
 *
 * Contra la VIVA (ep-shy-morning) solo con OK explícito de MJ (§4.7).
 * NO usa `prisma db push`: contra la viva ya borró datos una vez.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import path from "path";

const envPath = process.argv[2];
if (!envPath) throw new Error("uso: npx tsx scripts/aplicar-177-columna.ts <ruta-env>");
const raw = readFileSync(envPath, "utf8");
const m = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
if (!m) throw new Error("sin DATABASE_URL en " + envPath);
const url = m[1].trim();
const host = url.match(/ep-[a-z-]+|localhost/)?.[0] ?? "?";

const prisma = new PrismaClient({ datasources: { db: { url } } });

function partirSentencias(sqlConComentarios: string): string[] {
  // Primero afuera los comentarios de línea: un ";" dentro de un comentario
  // partiría la sentencia por la mitad.
  const sql = sqlConComentarios
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  const out: string[] = [];
  let actual = "";
  let enDollar = false;
  for (let i = 0; i < sql.length; i++) {
    if (sql.startsWith("$$", i)) {
      enDollar = !enDollar;
      actual += "$$";
      i++;
      continue;
    }
    const ch = sql[i];
    if (ch === ";" && !enDollar) {
      const limpio = actual.trim();
      if (limpio) out.push(limpio);
      actual = "";
    } else {
      actual += ch;
    }
  }
  return out;
}

async function main() {
  console.log("Base:", host);
  const sql = readFileSync(
    path.join(__dirname, "..", "prisma", "sql", "177-mueble-alternativas.sql"),
    "utf8",
  );
  // Prisma manda cada llamada como sentencia preparada, y Postgres no acepta
  // varias sentencias en una. Se parte el archivo por ";" respetando el bloque
  // DO $$ … $$ (que lleva ";" adentro).
  for (const stmt of partirSentencias(sql)) {
    if (process.argv.includes("--mostrar")) console.log("----\n" + stmt);
    else await prisma.$executeRawUnsafe(stmt);
  }
  const cols = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'MuebleItem' AND column_name = 'alternativeOfId'`;
  const fk = await prisma.$queryRaw<{ conname: string }[]>`
    SELECT conname FROM pg_constraint WHERE conname = 'MuebleItem_alternativeOfId_fkey'`;
  console.log("columna:", cols.length === 1 ? "OK" : "FALTA", "· fk:", fk.length === 1 ? "OK" : "FALTA");
  const alts = await prisma.muebleItem.count({ where: { alternativeOfId: { not: null } } });
  console.log("partidas marcadas como alternativa:", alts, "(recién aplicado debe ser 0)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
