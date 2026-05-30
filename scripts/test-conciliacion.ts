// Test de regresión (puro, sin BD) de la decisión de auto-match mov→factura.
// Congela el criterio conservador del ADR 2026-05-30:
//   - Con RUT (directo o vía alias de reembolsador): el RUT debe calzar.
//   - Sin RUT (compra con tarjeta): match por nombre de comercio, solo si hay
//     exactamente una factura de ese comercio. MercadoLibre queda excluido.
//   - Ante la duda, NO concilia. La fecha no interviene.
//
// Uso: npx tsx scripts/test-conciliacion.ts

import { decideMovementInvoiceMatch } from "../src/lib/banco/invoicePayments";

let ok = 0, fail = 0;
function check(nombre: string, real: unknown, esperado: unknown) {
  const pass = JSON.stringify(real) === JSON.stringify(esperado);
  console.log(`${pass ? "✓" : "✗"} ${nombre}`);
  if (!pass) { console.log(`    esperado: ${JSON.stringify(esperado)}\n    real:     ${JSON.stringify(real)}`); fail++; } else ok++;
}

// Atajos para armar candidatas y args. issueDate por defecto cerca del mov
// (2026-03-15) para que la ventana de fecha del camino por comercio no estorbe
// en los casos que no la testean.
const C = (id: string, rutIssuer: string | null, businessName: string | null = null, issueDate = "2026-03-15") =>
  ({ id, rutIssuer, rutReceiver: null, businessName, issueDate });
const cargo = (extra: Record<string, unknown>) =>
  ({ isCargo: true, movRutDigits: "", aliasRutDigits: [] as string[], movDescription: "", movDate: "2026-03-15", ...extra });

// ── CAMINO A: con RUT ──────────────────────────────────────────────────────

// 1. Un candidato y el RUT calza → concilia.
check("RUT calza (un candidato)", decideMovementInvoiceMatch(cargo({
  movRutDigits: "968034601", candidates: [C("F1", "96803460-1")],
})), { invoiceId: "F1" });

// 2. Un candidato pero el RUT NO calza (Pedro Barrera ↔ Vidrios Rotos) → NO concilia.
check("RUT distinto no concilia", decideMovementInvoiceMatch(cargo({
  movRutDigits: "112223334", candidates: [C("F1", "96803460-1")],
})), { reason: "no_rut_match" });

// 3. Varios candidatos; solo uno calza el RUT → ese.
check("varios, uno calza RUT", decideMovementInvoiceMatch(cargo({
  movRutDigits: "968034601", candidates: [C("F1", "77000000-0"), C("F2", "96803460-1")],
})), { invoiceId: "F2" });

// 4. Dos del MISMO proveedor y monto → ambiguo (no adivina por fecha).
check("dos del mismo proveedor es ambiguo", decideMovementInvoiceMatch(cargo({
  movRutDigits: "968034601", candidates: [C("F1", "96803460-1"), C("F2", "96803460-1")],
})), { reason: "ambiguous_multi" });

// 5. Match vía alias de reembolsador (mov a la persona, factura de su empresa).
check("match vía alias de reembolsador", decideMovementInvoiceMatch(cargo({
  movRutDigits: "154987177", aliasRutDigits: ["68885818"], candidates: [C("F1", "76888581-8")],
})), { invoiceId: "F1" });

// 6. Abono (emitida): valida rutReceiver, no rutIssuer.
check("abono valida rutReceiver", decideMovementInvoiceMatch({
  isCargo: false, movRutDigits: "763377717", aliasRutDigits: [], movDescription: "",
  candidates: [{ id: "E1", rutIssuer: "76000000-0", rutReceiver: "76337771-7", businessName: null }],
}), { invoiceId: "E1" });

// ── CAMINO B: compra con tarjeta (sin RUT) → por comercio ───────────────────

// 7. Compra Sodimac con UNA factura Sodimac del monto → concilia.
check("compra SODIMAC concilia con factura Sodimac", decideMovementInvoiceMatch(cargo({
  movDescription: "Compra SODIMAC PARQUE ARAUCO",
  candidates: [C("F1", "96792430-K", "SODIMAC S.A.")],
})), { invoiceId: "F1" });

// 7b. Homecenter (marca de Sodimac) en la factura también calza.
check("compra SODIMAC concilia con HOMECENTER", decideMovementInvoiceMatch(cargo({
  movDescription: "Compra SODIMAC CONST LAS",
  candidates: [C("F1", "96792430-K", "Sodimac Homecenter")],
})), { invoiceId: "F1" });

// 8. Compra Sodimac pero la única factura del monto es de OTRO comercio
//    (caso Habitat / peaje) → NO concilia.
check("SODIMAC con factura de otro comercio no concilia", decideMovementInvoiceMatch(cargo({
  movDescription: "Compra Nacional SODIMAC PARQUE",
  candidates: [C("F1", "88669200-5", "COMERCIAL HABITAT LIMITADA")],
})), { reason: "no_merchant_match" });

// 9. Dos facturas Sodimac del mismo monto → ambiguo, no adivina.
check("dos facturas Sodimac es ambiguo", decideMovementInvoiceMatch(cargo({
  movDescription: "Compra SODIMAC",
  candidates: [C("F1", "96792430-K", "SODIMAC S.A."), C("F2", "96792430-K", "SODIMAC S.A.")],
})), { reason: "ambiguous_merchant" });

// 10. El local Sherwin factura como "Vespucio Oriente" en la glosa.
check("VESPUCIO ORIENTE concilia con Sherwin", decideMovementInvoiceMatch(cargo({
  movDescription: "Compra VESPUCIO ORIENTE",
  candidates: [C("F1", "96803460-K", "SHERWIN WILLIAMS CHILE S A")],
})), { invoiceId: "F1" });

// 10b. Compra Sodimac pero la única factura Sodimac del monto está a MESES
//      de la compra → NO concilia (probablemente es otra compra del monto).
check("SODIMAC con factura a meses no concilia", decideMovementInvoiceMatch(cargo({
  movDescription: "Compra SODIMAC PARQUE", movDate: "2026-03-15",
  candidates: [C("F1", "96792430-K", "SODIMAC S.A.", "2025-10-22")],
})), { reason: "merchant_out_of_window" });

// 10c. Dos facturas Sodimac del monto, una lejos y una cerca → la fecha
//      desempata: concilia con la cercana.
check("la fecha desempata entre dos Sodimac", decideMovementInvoiceMatch(cargo({
  movDescription: "Compra SODIMAC", movDate: "2026-03-15",
  candidates: [
    C("F1", "96792430-K", "SODIMAC S.A.", "2025-09-01"),
    C("F2", "96792430-K", "SODIMAC S.A.", "2026-03-12"),
  ],
})), { invoiceId: "F2" });

// 11. MercadoPago NO se auto-concilia aunque haya factura del monto (la
//     factura suele ser de la tienda; comercio no reconocido) → pendiente.
check("MERCADOPAGO no auto-concilia", decideMovementInvoiceMatch(cargo({
  movDescription: "Compra MERCADOPAGO *MERC",
  candidates: [C("F1", "77398220-1", "MercadoLibre Chile LTDA")],
})), { reason: "no_rut_to_validate" });

// 12. Comercio no reconocido (glosa rara) → pendiente, no inventa.
check("comercio desconocido queda pendiente", decideMovementInvoiceMatch(cargo({
  movDescription: "Compra TIENDA RARA XYZ",
  candidates: [C("F1", "77000000-0", "ALGUNA EMPRESA SPA")],
})), { reason: "no_rut_to_validate" });

console.log(`\n${ok} ok, ${fail} fallan`);
process.exit(fail ? 1 : 0);
