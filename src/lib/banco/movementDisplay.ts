// Derivación de las columnas "Estado" y "Respaldo" de /banco/movimientos.
//
// Contexto (decisión MJ, jul 2026): la vieja columna "Estado" mezclaba dos
// preguntas — ¿está resuelto? y ¿con qué respaldo? — y salían inconsistencias
// (un pago a obra sin factura decía "Conciliado", una compra Google decía
// "Sin factura", siendo los dos "sin factura"). Ahora se separan en dos ejes:
//
//   - Estado   = ¿resuelto?  → Pendiente / Parcial / Pagado
//   - Respaldo = ¿qué es?    → Factura / Boleta / Internacional / Pago sin
//                              respaldo / (categoría de gasto propio) / Interna
//                              / Devolución
//
// TODO esto se DERIVA de datos que ya existen (status, pagos, origin de la
// factura, categoría). No cambia ningún cálculo ni el schema — es solo cómo se
// muestra. El pago a obra sigue contando en la obra igual que antes.

// ── Estado (resolución) ────────────────────────────────────────────────────
// sin_asignar → Pendiente · parcial → Parcial · el resto (conciliado,
// sin_factura, interno, neto_cero) ya está resuelto → Conciliado.
//
// Rótulo (decisión MJ, jul 2026): antes el resuelto decía "Pagado", que no
// calza para un movimiento del banco — un ingreso de $5.000.000 no está
// "pendiente de pago". Quedó "Conciliado": el mismo verbo que ya usa toda la
// zona banco ("Conciliar…", "Conciliar pendientes") y que las tarjetas de
// arriba. Se evaluó "Sin imputar / Imputado" y MJ prefirió este vocabulario.
export function deriveEstado(status: string): { label: string; tone: string } {
  if (status === "sin_asignar") {
    return { label: "Pendiente", tone: "bg-amber-100 text-amber-800" };
  }
  if (status === "parcial") {
    return { label: "Parcial", tone: "bg-amber-100 text-amber-800" };
  }
  return { label: "Conciliado", tone: "bg-green-100 text-green-800" };
}

// ── Respaldo a partir del origin de las facturas imputadas ──────────────────
// Un movimiento con pagos: el respaldo sale del origin de la(s) factura(s).
//   sii_automatica / manual → factura real (se muestra el folio, con link)
//   sin_respaldo            → pago a obra sin documento (folio fantasma SR-,
//                             se ESCONDE: solo se muestra "Pago sin respaldo")
//   gasto_boleta           → Boleta
//   gasto_internacional    → Internacional
export function derivePaymentRespaldo(
  origins: (string | null)[],
  folio: string | null
): { label: string; esFacturaReal: boolean } {
  if (origins.some((o) => o === "sin_respaldo")) {
    return { label: "Pago sin respaldo", esFacturaReal: false };
  }
  if (origins.some((o) => o === "gasto_boleta")) {
    return { label: "Boleta", esFacturaReal: false };
  }
  if (origins.some((o) => o === "gasto_internacional")) {
    return { label: "Internacional", esFacturaReal: false };
  }
  return {
    label: folio ? `Factura · F-${folio}` : "Factura",
    esFacturaReal: true,
  };
}
