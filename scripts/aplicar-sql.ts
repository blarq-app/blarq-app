/**
 * Aplica un archivo SQL idempotente de prisma/sql/ a la base cuyo DATABASE_URL
 * está en el .env que se pasa. Reemplaza a los scripts aplicar-<n>-*.ts de
 * un solo archivo.
 *
 *   npx tsx scripts/aplicar-sql.ts prisma/sql/178-plantillas-muebles.sql <ruta-env>
 *
 * Contra la VIVA (ep-shy-morning) solo con OK explícito de MJ (§4.7).
 * NO usa `prisma db push`: contra la viva ya borró datos una vez.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const [archivoSql, envPath] = process.argv.slice(2);
if (!archivoSql || !envPath) throw new Error("uso: npx tsx scripts/aplicar-sql.ts <archivo.sql> <ruta-env>");
const raw = readFileSync(envPath, "utf8");
const m = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
if (!m) throw new Error("sin DATABASE_URL en " + envPath);
const url = m[1].trim();
const host = url.match(/ep-[a-z-]+|localhost/)?.[0] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

// Prisma manda cada llamada como sentencia preparada, y Postgres no acepta
// varias en una. Se parte el archivo por ";" respetando los bloques DO $$…$$
// (que llevan ";" adentro). Los comentarios de línea salen antes: un ";"
// dentro de un comentario partiría la sentencia.
function partirSentencias(sqlConComentarios: string): string[] {
  const sql = sqlConComentarios.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
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
  console.log("Base:", host, "· archivo:", archivoSql);
  const sentencias = partirSentencias(readFileSync(archivoSql, "utf8"));
  for (const stmt of sentencias) {
    if (process.argv.includes("--mostrar")) console.log("----\n" + stmt);
    else await prisma.$executeRawUnsafe(stmt);
  }
  console.log(`${sentencias.length} sentencias ${process.argv.includes("--mostrar") ? "mostradas" : "aplicadas"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
