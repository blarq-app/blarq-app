/**
 * Agrega a la tabla Invoice las dos columnas del desglose de cobro combinado:
 * `montoObra` y `montoMuebles`. Aditivo y nullable — no toca ni un dato que ya
 * exista, y una fila sin desglose las deja en NULL, que es el comportamiento de
 * siempre.
 *
 * SQL QUIRÚRGICO a propósito (no `prisma db push` ni `migrate diff`): un diff
 * completo contra la base viva arrastra cambios de OTRAS ramas y puede soltar
 * columnas que sí están en uso. Lección del incidente #178.
 *
 * Corre contra las DOS bases (la viva y la de desarrollo) para que no queden
 * desfasadas. Es idempotente: `ADD COLUMN IF NOT EXISTS`.
 *
 * Dry-run por defecto. Escribe solo con --apply.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");

function urlDe(ruta: string): string {
  return readFileSync(ruta, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("DATABASE_URL="))!
    .slice("DATABASE_URL=".length)
    .replace(/^["']|["']$/g, "");
}

const BASES = [
  { rotulo: "VIVA", url: urlDe("/Users/mjblanco/Desktop/blarq-app/.env.prod") },
  { rotulo: "desarrollo", url: urlDe("/Users/mjblanco/Desktop/blarq-app/.env") },
];

const SQL = `
  ALTER TABLE "Invoice"
    ADD COLUMN IF NOT EXISTS "montoObra" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "montoMuebles" DOUBLE PRECISION;
`;

async function main() {
  console.log("MODO:", APPLY ? "APLICAR" : "DRY-RUN");
  console.log("SQL:", SQL.trim());

  for (const b of BASES) {
    const host = b.url.match(/@([^/]+)\//)?.[1] ?? "???";
    const prisma = new PrismaClient({ datasources: { db: { url: b.url } } });
    try {
      const antes = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'Invoice' AND column_name IN ('montoObra','montoMuebles')`
      );
      console.log(`\n[${b.rotulo}] ${host}`);
      console.log(`  columnas presentes antes: ${antes.length ? antes.map((c) => c.column_name).join(", ") : "(ninguna)"}`);

      if (!APPLY) continue;

      await prisma.$executeRawUnsafe(SQL);
      const despues = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'Invoice' AND column_name IN ('montoObra','montoMuebles')`
      );
      console.log(`  columnas presentes después: ${despues.map((c) => c.column_name).sort().join(", ")}`);
      const filas = await prisma.invoice.count();
      const conDato = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(*) AS n FROM "Invoice" WHERE "montoObra" IS NOT NULL OR "montoMuebles" IS NOT NULL`
      );
      console.log(`  facturas en la tabla: ${filas} · con desglose cargado: ${Number(conDato[0].n)}`);
    } finally {
      await prisma.$disconnect();
    }
  }

  if (!APPLY) console.log("\nDRY-RUN: no se ejecutó el ALTER. Correr con --apply.");
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exitCode = 1;
});
