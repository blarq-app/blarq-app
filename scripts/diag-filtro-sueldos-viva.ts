// SOLO LECTURA. Reproduce, contra la base que se le pase, EXACTAMENTE lo que
// muestra el filtro "Imputación = Sueldos" en banco/movimientos: movimientos con
// category="sueldo". Para cada uno marca si tiene FACTURA conciliada (payments),
// que es justo lo que NO debería aparecer bajo "sueldos".
// Uso: npx tsx scripts/diag-filtro-sueldos-viva.ts <ruta-env>
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const envPath = process.argv[2];
const raw = readFileSync(envPath, "utf8");
const url = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)![1].trim();
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });
const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  console.log("=== HOST:", host, "===");
  const movs = await prisma.bankMovement.findMany({
    where: { category: "sueldo" },
    select: { date: true, amount: true, counterpartyName: true, payments: { select: { id: true } } },
    orderBy: { date: "desc" },
  });
  const conFactura = movs.filter((m) => m.payments.length > 0);
  console.log(`Filtro "sueldos" muestra: ${movs.length} movimientos`);
  console.log(`  de los cuales CON factura conciliada (no deberían estar): ${conFactura.length}`);
  for (const m of conFactura) {
    console.log(`    ✗ ${m.date.toISOString().slice(0, 10)} ${clp(Math.abs(m.amount))} ${m.counterpartyName ?? ""}`);
  }
  console.log(conFactura.length === 0 ? "  ✓ Ninguno con factura — limpio." : "");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
