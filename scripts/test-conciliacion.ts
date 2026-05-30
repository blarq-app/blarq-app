// Test de regresión (puro, sin BD) de la decisión de auto-match mov→factura.
// Congela el criterio conservador del ADR 2026-05-30: el RUT debe calzar
// (directo o vía alias de reembolsador); si no hay RUT o es ambiguo, NO
// concilia. La fecha no interviene.
//
// Uso: npx tsx scripts/test-conciliacion.ts

import { decideMovementInvoiceMatch } from "../src/lib/banco/invoicePayments";

let ok = 0, fail = 0;
function check(nombre: string, real: unknown, esperado: unknown) {
  const pass = JSON.stringify(real) === JSON.stringify(esperado);
  console.log(`${pass ? "✓" : "✗"} ${nombre}`);
  if (!pass) { console.log(`    esperado: ${JSON.stringify(esperado)}\n    real:     ${JSON.stringify(real)}`); fail++; } else ok++;
}

// Cargo (recibida): el RUT a validar es rutIssuer (proveedor).
const cargo = { isCargo: true };

// 1. Compra con tarjeta: mov sin RUT, sin alias → NO concilia (el bug histórico).
check("compra sin RUT no se concilia", decideMovementInvoiceMatch({
  ...cargo, movRutDigits: "", aliasRutDigits: [],
  candidates: [{ id: "F1", rutIssuer: "96803460-1", rutReceiver: null }],
}), { reason: "no_rut_to_validate" });

// 2. Un candidato y el RUT calza → concilia.
check("un candidato con RUT que calza", decideMovementInvoiceMatch({
  ...cargo, movRutDigits: "968034601", aliasRutDigits: [],
  candidates: [{ id: "F1", rutIssuer: "96803460-1", rutReceiver: null }],
}), { invoiceId: "F1" });

// 3. Un candidato pero el RUT NO calza (Pedro Barrera ↔ Vidrios Rotos) → NO concilia.
check("un candidato con RUT distinto no se concilia", decideMovementInvoiceMatch({
  ...cargo, movRutDigits: "112223334", aliasRutDigits: [],
  candidates: [{ id: "F1", rutIssuer: "96803460-1", rutReceiver: null }],
}), { reason: "no_rut_match" });

// 4. Varios candidatos del mismo monto; solo uno calza el RUT → ese.
check("varios candidatos, uno calza RUT", decideMovementInvoiceMatch({
  ...cargo, movRutDigits: "968034601", aliasRutDigits: [],
  candidates: [
    { id: "F1", rutIssuer: "77000000-0", rutReceiver: null },
    { id: "F2", rutIssuer: "96803460-1", rutReceiver: null },
  ],
}), { invoiceId: "F2" });

// 5. Dos candidatos del MISMO proveedor y monto → ambiguo, NO adivina por fecha.
check("dos del mismo proveedor es ambiguo", decideMovementInvoiceMatch({
  ...cargo, movRutDigits: "968034601", aliasRutDigits: [],
  candidates: [
    { id: "F1", rutIssuer: "96803460-1", rutReceiver: null },
    { id: "F2", rutIssuer: "96803460-1", rutReceiver: null },
  ],
}), { reason: "ambiguous_multi" });

// 6. Reembolsador: mov a la persona (RUT no calza directo) pero la empresa
//    de la factura está en los aliases → concilia vía alias.
check("match vía alias de reembolsador", decideMovementInvoiceMatch({
  ...cargo, movRutDigits: "154987177", aliasRutDigits: ["68885818"],
  candidates: [{ id: "F1", rutIssuer: "76888581-8", rutReceiver: null }],
}), { invoiceId: "F1" });

// 7. Abono (emitida): valida rutReceiver (cliente), no rutIssuer.
check("abono valida rutReceiver", decideMovementInvoiceMatch({
  isCargo: false, movRutDigits: "763377717", aliasRutDigits: [],
  candidates: [{ id: "E1", rutIssuer: "76000000-0", rutReceiver: "76337771-7" }],
}), { invoiceId: "E1" });

console.log(`\n${ok} ok, ${fail} fallan`);
process.exit(fail ? 1 : 0);
