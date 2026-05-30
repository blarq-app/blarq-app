/**
 * Detecta grupos de facturas "ambiguas": mismo proveedor + mismo monto
 * + ≥2 facturas + ≥2 con pagos linkeados. Son las candidatas a tener
 * pagos cruzados entre facturas (la auditoría general no las detecta).
 *
 * Por cada grupo, lista las facturas (folio, fecha) y quién paga cada una
 * (mov fecha + descripción). MJ revisa si las fechas calzan con el
 * concepto del email/factura real.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const f = (n: number) => "$" + Math.round(Math.abs(n)).toLocaleString("es-CL");
const d = (x: Date) => x.toISOString().slice(0, 10);
const CUTOFF = new Date("2026-01-01");

async function main() {
  // Facturas 2026 con sus pagos
  const facs = await prisma.invoice.findMany({
    where: { tipoDoc: { not: 61 }, issueDate: { gte: CUTOFF } },
    select: {
      id: true, folioNumber: true, businessName: true, rutIssuer: true,
      issueDate: true, totalAmount: true, status: true,
      payments: {
        select: {
          amountApplied: true,
          bankMovement: { select: { date: true, description: true, counterpartyRut: true } },
        },
      },
    },
  });

  // Agrupar por (rutIssuer, totalAmount). Solo grupos ≥2 facturas y ≥2 con pago.
  type Grp = { rut: string; biz: string; amount: number; facs: typeof facs };
  const groups = new Map<string, Grp>();
  for (const fa of facs) {
    const key = `${fa.rutIssuer ?? ""}|${fa.totalAmount}`;
    if (!groups.has(key)) {
      groups.set(key, { rut: fa.rutIssuer ?? "", biz: fa.businessName ?? "", amount: fa.totalAmount, facs: [] });
    }
    groups.get(key)!.facs.push(fa);
  }

  const ambiguous = [...groups.values()].filter((g) => {
    if (g.facs.length < 2) return false;
    const conPago = g.facs.filter((fa) => fa.payments.length > 0).length;
    return conPago >= 2;
  });

  // Orden: primero los más ambiguos (más facturas) y proveedores frecuentes
  ambiguous.sort((a, b) => {
    if (b.facs.length !== a.facs.length) return b.facs.length - a.facs.length;
    return b.amount - a.amount;
  });

  console.log("=".repeat(80));
  console.log(`GRUPOS AMBIGUOS 2026: mismo proveedor + mismo monto + ≥2 con pago`);
  console.log(`Total: ${ambiguous.length}`);
  console.log("=".repeat(80));

  for (const g of ambiguous) {
    console.log(`\n▶ ${g.biz.slice(0,32).padEnd(32)} | RUT ${g.rut} | ${f(g.amount)} × ${g.facs.length} facturas`);
    // Por factura, mostrar quién la pagó
    const sorted = [...g.facs].sort((a, b) => a.issueDate.getTime() - b.issueDate.getTime());
    for (const fa of sorted) {
      const pagos = fa.payments;
      if (pagos.length === 0) {
        console.log(`   ${d(fa.issueDate)} F-${(fa.folioNumber ?? "").padStart(5)} | ${fa.status.padEnd(9)} | sin pago linkeado`);
      } else {
        for (const p of pagos) {
          const movDate = d(p.bankMovement.date);
          const desc = (p.bankMovement.description ?? "").slice(0, 35);
          const diasDiff = Math.round((p.bankMovement.date.getTime() - fa.issueDate.getTime()) / 86400000);
          const diasLabel = diasDiff === 0 ? "mismo dia" : (diasDiff > 0 ? `+${diasDiff}d` : `${diasDiff}d`);
          console.log(`   ${d(fa.issueDate)} F-${(fa.folioNumber ?? "").padStart(5)} | ${fa.status.padEnd(9)} | mov ${movDate} (${diasLabel.padStart(7)}) "${desc}"`);
        }
      }
    }
  }
}
main().finally(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
