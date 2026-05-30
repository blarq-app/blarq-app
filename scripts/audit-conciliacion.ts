/**
 * Auditoría de conciliación bancaria.
 * Read-only. Reporta:
 *   A. Sobre-imputación de factura (suma pagos > total + $10)
 *   B. Sobre-imputación de movimiento (suma pagos > |amount| + $10)
 *   C. Pago con RUT que no calza (mov.counterpartyRut ≠ factura RUT
 *      contraparte, y no explicado por alias de reembolsador)
 *   D. Status atrasado (factura con pagos pero pendiente)
 *   E. Pagos duplicados (mismo (movId, invoiceId) más de una vez)
 *   F. Mov con pagos pero status sin_asignar
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const f = (n: number) => "$" + Math.round(Math.abs(n)).toLocaleString("es-CL");
const d = (x: Date) => x.toISOString().slice(0, 10);

async function main() {
  // Reembolsadores: para validar alias en (C).
  const reembolsadores = await prisma.reembolsador.findMany({
    select: { glosa: true, personRut: true, aliases: { select: { rut: true } } },
  });
  function aliasRutsFor(mov: { description: string | null; counterpartyRut: string | null }): string[] {
    const desc = (mov.description ?? "").toLowerCase();
    const movRut = (mov.counterpartyRut ?? "").replace(/\D/g, "");
    const ruts = new Set<string>();
    for (const r of reembolsadores) {
      const pr = (r.personRut ?? "").replace(/\D/g, "");
      const matchRut = pr.length > 0 && movRut && (pr.includes(movRut) || movRut.includes(pr));
      const matchGlosa = desc.includes(r.glosa.toLowerCase());
      if (matchRut || matchGlosa) {
        for (const a of r.aliases) {
          const dx = a.rut.replace(/\D/g, "");
          if (dx.length > 6) ruts.add(dx.slice(0, -1)); // cuerpo del RUT
        }
      }
    }
    return [...ruts];
  }

  // === A + D: Por factura, suma de pagos vs total + status ===
  const facs = await prisma.invoice.findMany({
    where: { tipoDoc: { not: 61 } },
    select: { id: true, folioNumber: true, businessName: true, totalAmount: true, status: true, type: true, rutIssuer: true, rutReceiver: true, payments: { select: { id: true, amountApplied: true, bankMovementId: true } } },
  });

  const overInvoices: { folio: string; biz: string; total: number; sum: number; excess: number }[] = [];
  const statusDrift: { folio: string; biz: string; total: number; sum: number; status: string; should: string }[] = [];
  for (const fa of facs) {
    if (fa.status === "anulada") continue;
    const sum = fa.payments.reduce((s, p) => s + p.amountApplied, 0);
    if (sum > fa.totalAmount + 10) {
      overInvoices.push({ folio: fa.folioNumber ?? "?", biz: (fa.businessName ?? "").slice(0,28), total: fa.totalAmount, sum, excess: sum - fa.totalAmount });
    }
    // Status correcto
    let should = "pendiente";
    if (sum >= fa.totalAmount - 1) should = "pagada";
    else if (sum > 0) should = "parcial";
    if (should !== fa.status && sum > 0) {
      statusDrift.push({ folio: fa.folioNumber ?? "?", biz: (fa.businessName ?? "").slice(0,28), total: fa.totalAmount, sum, status: fa.status, should });
    }
  }

  // === B + F: Por mov, suma de pagos vs |amount| + status ===
  const movs = await prisma.bankMovement.findMany({
    where: { payments: { some: {} } },
    select: { id: true, date: true, amount: true, status: true, description: true, counterpartyRut: true, payments: { select: { id: true, amountApplied: true, invoiceId: true, invoice: { select: { folioNumber: true, businessName: true, type: true, rutIssuer: true, rutReceiver: true } } } } },
  });
  const overMovs: { date: string; desc: string; amount: number; sum: number; excess: number }[] = [];
  const movStatusDrift: { date: string; desc: string; amount: number; sum: number; status: string; should: string }[] = [];
  for (const m of movs) {
    if (m.status === "interno") continue;
    const abs = Math.abs(m.amount);
    const sum = m.payments.reduce((s, p) => s + p.amountApplied, 0);
    if (sum > abs + 10) {
      overMovs.push({ date: d(m.date), desc: (m.description ?? "").slice(0,30), amount: abs, sum, excess: sum - abs });
    }
    let should = "sin_asignar";
    if (sum >= abs - 1) should = "conciliado";
    else if (sum > 0) should = "parcial";
    if (m.status !== should && m.status !== "sin_factura") {
      movStatusDrift.push({ date: d(m.date), desc: (m.description ?? "").slice(0,30), amount: abs, sum, status: m.status, should });
    }
  }

  // === C: Pagos con RUT que no calza (ni directo, ni por alias) ===
  const wrongRut: { mov: string; movRut: string; folio: string; biz: string; facRut: string }[] = [];
  for (const m of movs) {
    const movRutDigits = (m.counterpartyRut ?? "").replace(/\D/g, "");
    if (!movRutDigits) continue; // no podemos verificar
    const movRutBody = movRutDigits.slice(0, -1).replace(/^0+/, "");
    const aliasBodies = aliasRutsFor(m);
    for (const p of m.payments) {
      const isCargo = m.amount < 0;
      const expectedRut = (isCargo ? p.invoice.rutIssuer : p.invoice.rutReceiver) ?? "";
      const facBody = expectedRut.replace(/\D/g, "").replace(/^0+/, "").slice(0, -1);
      if (!facBody) continue;
      const direct = movRutBody.includes(facBody) || facBody.includes(movRutBody);
      const viaAlias = aliasBodies.some((a) => a.includes(facBody) || facBody.includes(a));
      if (!direct && !viaAlias) {
        wrongRut.push({
          mov: d(m.date) + " | " + (m.description ?? "").slice(0,30),
          movRut: m.counterpartyRut ?? "",
          folio: p.invoice.folioNumber ?? "?",
          biz: (p.invoice.businessName ?? "").slice(0,28),
          facRut: expectedRut,
        });
      }
    }
  }

  // === E: Pagos duplicados ===
  // El schema tiene @@unique([bankMovementId, invoiceId]) → no debería haber.
  // Pero por las dudas, agrupo.
  const dupCheck = new Map<string, number>();
  for (const m of movs) for (const p of m.payments) {
    const k = m.id + "|" + p.invoiceId;
    dupCheck.set(k, (dupCheck.get(k) ?? 0) + 1);
  }
  const dups = [...dupCheck.entries()].filter(([, c]) => c > 1);

  // ─── REPORTE ───
  console.log("=".repeat(80));
  console.log("AUDITORÍA DE CONCILIACIÓN BANCARIA");
  console.log("=".repeat(80));
  console.log(`\nFacturas analizadas: ${facs.length} | Movs con pagos: ${movs.length}`);

  console.log(`\n--- A. Facturas SOBRE-IMPUTADAS (suma pagos > total + $10): ${overInvoices.length} ---`);
  for (const x of overInvoices) console.log(`   F-${x.folio} ${x.biz} | total ${f(x.total)} | suma pagos ${f(x.sum)} | excede ${f(x.excess)}`);

  console.log(`\n--- B. Movs SOBRE-IMPUTADOS (suma pagos > |amount| + $10): ${overMovs.length} ---`);
  for (const x of overMovs) console.log(`   ${x.date} | ${x.desc} | mov ${f(x.amount)} | suma pagos ${f(x.sum)} | excede ${f(x.excess)}`);

  console.log(`\n--- C. Pagos con RUT que NO CALZA (ni directo ni por alias): ${wrongRut.length} ---`);
  for (const x of wrongRut.slice(0, 50)) console.log(`   mov ${x.mov} (RUT ${x.movRut}) → F-${x.folio} ${x.biz} (RUT ${x.facRut})`);
  if (wrongRut.length > 50) console.log(`   ... y ${wrongRut.length - 50} más`);

  console.log(`\n--- D. Facturas con STATUS ATRASADO (tienen pago pero status menor): ${statusDrift.length} ---`);
  for (const x of statusDrift.slice(0, 30)) console.log(`   F-${x.folio} ${x.biz} | total ${f(x.total)} | pagado ${f(x.sum)} | ${x.status} → ${x.should}`);
  if (statusDrift.length > 30) console.log(`   ... y ${statusDrift.length - 30} más`);

  console.log(`\n--- E. Pagos DUPLICADOS (mismo mov+factura): ${dups.length} ---`);
  for (const [k, c] of dups) console.log(`   ${k} × ${c}`);

  console.log(`\n--- F. Movs con pagos pero STATUS atrasado: ${movStatusDrift.length} ---`);
  for (const x of movStatusDrift.slice(0, 30)) console.log(`   ${x.date} | ${x.desc} | ${f(x.amount)} | pagado ${f(x.sum)} | ${x.status} → ${x.should}`);

  console.log("\n" + "=".repeat(80));
  console.log("RESUMEN");
  console.log(`  A. Facturas sobre-imputadas: ${overInvoices.length}`);
  console.log(`  B. Movs sobre-imputados:     ${overMovs.length}`);
  console.log(`  C. RUT no calza:             ${wrongRut.length}`);
  console.log(`  D. Status factura atrasado:  ${statusDrift.length}`);
  console.log(`  E. Pagos duplicados:         ${dups.length}`);
  console.log(`  F. Status mov atrasado:      ${movStatusDrift.length}`);
  console.log("=".repeat(80));
}
main().finally(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
