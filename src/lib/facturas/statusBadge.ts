// Etiqueta y color del badge de estado de una factura.
//
// La base guarda el estado crudo: "pendiente" | "parcial" | "pagada" |
// "anulada". El badge muestra ese valor tal cual (en mayúscula por CSS).
//
// El estado responde a UNA sola pregunta: ¿se movió plata mía?
//   - pagada  → la compra se saldó con plata real (transferencia) y/o con el
//               crédito de una NC. Fue un gasto real.
//   - parcial → saldada en parte, todavía se debe el resto.
//   - anulada → NO se movió plata: la compra se deshizo entera (típico: el
//               proveedor facturó por error y emitió una NC por el total).
//               Queda fuera de los registros. Se muestra ANULADA, sin
//               disfrazarla de pagada.
//
// El hecho de "esta factura recibió una NC" es un dato APARTE, independiente
// del estado, y se muestra como una marca propia en la fila/ficha (ver
// FacturasTable y la ficha de factura), NO secuestrando el badge. Así una
// factura puede leerse "PAGADA + marca NC" (devolución parcial sobre una
// compra que igual se pagó) o "ANULADA + marca NC" (anulación real), cada
// caso como es.
//
// IMPORTANTE: esto es SOLO presentación. metrics.ts ya descuenta la NC por su
// lado y la plata no se toca acá.

export const STATUS_TONE: Record<string, string> = {
  pendiente: "bg-yellow-100 text-yellow-800",
  parcial: "bg-blue-100 text-blue-800",
  pagada: "bg-green-100 text-green-800",
  anulada: "bg-gray-100 text-gray-500",
};

export function invoiceStatusBadge(
  status: string,
  opts: {
    // true = es una NC (61) que ya se compensó (efectivo / banco / aplicada
    // a otra factura). Su estado interno queda "pagada", pero una NC no se
    // "paga" — se compensa. Mostramos "compensada" para que se entienda.
    isCompensatedNc?: boolean;
  } = {}
): { label: string; tone: string } {
  if (opts.isCompensatedNc) {
    return { label: "compensada", tone: "bg-blue-100 text-blue-800" };
  }
  return { label: status, tone: STATUS_TONE[status] || "bg-gray-100" };
}
