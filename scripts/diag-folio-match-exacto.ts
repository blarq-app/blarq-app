// Diagnóstico SOLO LECTURA: demuestra el fix de "folio por CONTAINS vs EXACTO".
// Uso: npx tsx scripts/diag-folio-match-exacto.ts <ruta-env> [folio]
// Muestra qué facturas trae el folio por "contiene" (bug) vs "exacto" (fix).
// No escribe nada.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2] ?? ".env.prod";
const folio = process.argv[3] ?? "3322";
const raw = readFileSync(envPath, "utf8");
const m = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
if (!m) {
  console.error("no DATABASE_URL en", envPath);
  process.exit(1);
}
const url = m[1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  console.log("=== ENV:", envPath, "| HOST:", host, "===");
  // Marcador de base viva: #64 debe ser "Paseo del Sena".
  const p64 = await prisma.project.findFirst({
    where: { numeroProyecto: 64 },
    select: { name: true },
  });
  console.log(`Marcador base viva → #64: ${p64?.name ?? "(no existe)"}`);
  console.log("");

  console.log(`--- ANTES (contains "${folio}") — el bug ---`);
  const contiene = await prisma.invoice.findMany({
    where: { folioNumber: { contains: folio, mode: "insensitive" } },
    select: { id: true, folioNumber: true, businessName: true, totalAmount: true },
    orderBy: { folioNumber: "asc" },
    take: 20,
  });
  for (const f of contiene) {
    console.log(`  F-${f.folioNumber}  ${f.businessName ?? "-"}  (${f.totalAmount})`);
  }
  console.log(`  → ${contiene.length} factura(s)`);
  console.log("");

  console.log(`--- DESPUÉS (folio EXACTO "${folio}") — el fix ---`);
  const exacto = await prisma.invoice.findMany({
    where: { folioNumber: folio },
    select: { id: true, folioNumber: true, businessName: true, totalAmount: true },
    take: 20,
  });
  for (const f of exacto) {
    console.log(`  F-${f.folioNumber}  ${f.businessName ?? "-"}  (${f.totalAmount})  id=${f.id}`);
  }
  console.log(`  → ${exacto.length} factura(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
