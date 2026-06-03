// DIAGNÓSTICO — SOLO LECTURA. Usa la lógica REAL de auto-match
// (decideMovementInvoiceMatch) para explicar, movimiento por movimiento, por
// qué la conciliación automática lo concilia o no. No escribe nada.

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { decideMovementInvoiceMatch, loadCandidateInvoices } from "../src/lib/banco/invoicePayments";
const prisma = new PrismaClient();

async function main() {
  const movs = await prisma.bankMovement.findMany({
    where: { amount: { lt: 0 }, status: { in: ["sin_asignar", "parcial"] }, payments: { none: {} } },
    select: { id: true, date: true, amount: true, description: true, counterpartyRut: true },
    orderBy: { date: "desc" },
  });
  const cands = await loadCandidateInvoices();

  const cuenta: Record<string, number> = {};
  const matches: string[] = [];

  for (const m of movs) {
    const abs = Math.abs(m.amount);
    const raw = cands.filter((c) => c.type === "recibida" && c.totalAmount >= abs - 10);
    const candidatas = raw
      .map((c) => ({ ...c, remaining: c.totalAmount - c.payments.reduce((s, p) => s + p.amountApplied, 0) }))
      .filter((c) => c.remaining >= abs - 10 && c.remaining <= abs + 10);

    let reason = "no_candidates";
    let invId = "";
    if (candidatas.length > 0) {
      const d = decideMovementInvoiceMatch({
        candidates: candidatas,
        isCargo: true,
        movRutDigits: (m.counterpartyRut ?? "").replace(/\D/g, ""),
        aliasRutDigits: [],
        movDescription: m.description,
        movDate: m.date,
      });
      if ("invoiceId" in d) { reason = "MATCH"; invId = d.invoiceId; }
      else reason = d.reason;
    }
    cuenta[reason] = (cuenta[reason] ?? 0) + 1;
    if (reason === "MATCH") {
      const f = candidatas.find((c) => c.id === invId)!;
      matches.push(`  ${m.date.toISOString().slice(0,10)} ${String(m.amount).padStart(10)} ${m.description}  ->  ${f.businessName} $${f.totalAmount}`);
    }
    // Casos donde HAY factura del mismo monto pero no se reconoció comercio:
    // mostrar el movimiento y los nombres de las facturas candidatas.
    if (reason === "no_rut_to_validate" || reason === "ambiguous_merchant" || reason === "merchant_out_of_window") {
      const nombres = candidatas.map((c) => `${c.businessName} $${c.totalAmount} (${new Date(c.issueDate).toISOString().slice(0,10)})`).join(" | ");
      matches.push(`  [${reason}] ${m.date.toISOString().slice(0,10)} ${String(m.amount).padStart(10)} ${m.description}\n       cand: ${nombres}`);
    }
  }

  console.log("Resumen razón de auto-match (egresos pendientes):");
  for (const [k, v] of Object.entries(cuenta).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${v}`);
  console.log(`\nDetalle (matches + comercios no reconocidos con factura de igual monto):`);
  matches.forEach((l) => console.log(l));
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL:", e); await prisma.$disconnect(); process.exit(1); });
