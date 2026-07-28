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
// sin_factura, interno, neto_cero) ya está resuelto → Pagado.
export function deriveEstado(status: string): { label: string; tone: string } {
  if (status === "sin_asignar") {
    return { label: "Pendiente", tone: "bg-amber-100 text-amber-800" };
  }
  if (status === "parcial") {
    return { label: "Parcial", tone: "bg-amber-100 text-amber-800" };
  }
  return { label: "Pagado", tone: "bg-green-100 text-green-800" };
}

// ── Respaldo a partir del origin de las facturas imputadas ──────────────────
// Un movimiento con pagos: el respaldo sale del origin de la(s) factura(s).
//   sii_automatica / manual → factura real (se muestra el folio, con link)
//   sin_respaldo            → pago a obra sin documento (folio fantasma SR-,
//                             se ESCONDE: solo se muestra "Pago sin respaldo")
//   gasto_boleta           → Boleta
//   gasto_internacional    → Internacional
//
// `indicePago` es la posición del pago que determinó la etiqueta. Importa
// cuando un mismo movimiento paga varias facturas de distinto tipo: la etiqueta
// la gana el primer `sin_respaldo` (o boleta / internacional), así que el link
// tiene que apuntar a ESA factura y no ciegamente a la primera del movimiento.
//
// `linkeable`: el rótulo se muestra como link al detalle de la factura. Vale
// tanto para la factura real como para el "pago sin respaldo" — atrás de los
// dos hay una factura de verdad (la SR- es sintética pero existe, con su obra
// guardada), así que clickear el rótulo abre el pago y ahí se ve el proyecto.
// Boleta e internacional quedan por ahora como texto (MJ no las pidió).
export function derivePaymentRespaldo(
  origins: (string | null)[],
  folio: string | null
): { label: string; linkeable: boolean; indicePago: number } {
  const iSinRespaldo = origins.findIndex((o) => o === "sin_respaldo");
  if (iSinRespaldo >= 0) {
    return {
      label: "Pago sin respaldo",
      linkeable: true,
      indicePago: iSinRespaldo,
    };
  }
  const iBoleta = origins.findIndex((o) => o === "gasto_boleta");
  if (iBoleta >= 0) {
    return {
      label: "Boleta",
      linkeable: false,
      indicePago: iBoleta,
    };
  }
  const iInternacional = origins.findIndex((o) => o === "gasto_internacional");
  if (iInternacional >= 0) {
    return {
      label: "Internacional",
      linkeable: false,
      indicePago: iInternacional,
    };
  }
  return {
    label: folio ? `Factura · F-${folio}` : "Factura",
    linkeable: true,
    indicePago: 0,
  };
}
