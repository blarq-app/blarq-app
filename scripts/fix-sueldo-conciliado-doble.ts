// CORRIDA ÚNICA. Limpia la categoría de pago-a-socio (sueldo / retiro_personal /
// bono_socio / prestamo_socio) en los movimientos que ADEMÁS están imputados a
// una factura (InvoicePayment). Esos son reembolsos ya conciliados: la factura
// del proveedor manda, el rótulo de sueldo/pago-a-socio sobra. Deja category=null
// (que es como quedan todos los movimientos conciliados por los caminos manuales).
//
// NO toca el estado (status) ni las imputaciones ni el monto — SOLO borra el
// rótulo category. No afecta el Estado de Resultado (esos movimientos ya se
// cuentan como reembolso operativo, no como sueldo — ver diagnóstico).
//
// Por default es DRY-RUN (no escribe). Para escribir de verdad: --apply
// Uso: npx tsx scripts/fix-sueldo-conciliado-doble.ts <ruta-env> [--apply]
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const CATEGORIAS_PAGO_SOCIO = ["sueldo", "retiro_personal", "bono_socio", "prestamo_socio"];

const envPath = process.argv[2];
const apply = process.argv.includes("--apply");
if (!envPath) {
  console.error("Falta la ruta al .env. Uso: npx tsx scripts/fix-sueldo-conciliado-doble.ts <ruta-env> [--apply]");
  process.exit(1);
}
const raw = readFileSync(envPath, "utf8");
const url = raw.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]?.trim();
if (!url) {
  console.error("no DATABASE_URL en", envPath);
  process.exit(1);
}
const host = url.match(/@([^/.]+)/)?.[1] ?? "?";
const prisma = new PrismaClient({ datasources: { db: { url } } });
const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

async function main() {
  console.log("=== ENV:", envPath, "| HOST:", host, "| MODO:", apply ? "APPLY (escribe)" : "DRY-RUN (no escribe)", "===");

  const movs = await prisma.bankMovement.findMany({
    where: {
      category: { in: CATEGORIAS_PAGO_SOCIO },
      payments: { some: {} },
    },
    select: { id: true, date: true, amount: true, category: true, counterpartyName: true },
    orderBy: { date: "asc" },
  });

  console.log(`Candidatos: ${movs.length} · ${clp(movs.reduce((s, m) => s + Math.abs(m.amount), 0))}`);
  for (const mv of movs) {
    console.log(`  ${mv.date.toISOString().slice(0, 10)} | ${mv.category} → null | ${clp(Math.abs(mv.amount))} | ${mv.counterpartyName ?? "—"}`);
  }

  if (!apply) {
    console.log("\nDRY-RUN. Nada escrito. Para aplicar: agregá --apply");
    return;
  }

  const ids = movs.map((m) => m.id);
  const res = await prisma.bankMovement.updateMany({
    where: { id: { in: ids } },
    data: { category: null },
  });
  console.log(`\nAPLICADO. Movimientos actualizados (category→null): ${res.count}`);

  // Verificación post: no debe quedar ninguno con categoría pago-a-socio + pago.
  const quedan = await prisma.bankMovement.count({
    where: { category: { in: CATEGORIAS_PAGO_SOCIO }, payments: { some: {} } },
  });
  console.log(`Quedan con doble identidad: ${quedan} (debe ser 0)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
