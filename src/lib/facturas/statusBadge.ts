// Etiqueta y color del badge de estado de una factura.
//
// La base guarda el estado crudo: "pendiente" | "parcial" | "pagada" |
// "anulada". El badge normalmente muestra ese valor tal cual (en mayúscula
// por CSS).
//
// Caso especial — "pagada con NC": una factura que figura "anulada" porque
// quedó cubierta entera por el crédito de una nota de crédito NO es una
// anulación real; se saldó con el crédito (típico: error de facturación que
// el proveedor corrige con una NC). Mostrarla como "ANULADA" confunde. Si
// hay una NC aplicada a esta factura, la mostramos como "PAGADA CON NC"
// (verde). Si no hay NC aplicada, "anulada" sigue siendo una anulación real
// y se muestra como "ANULADA" (gris).
//
// IMPORTANTE: esto es SOLO presentación. El valor en la base sigue siendo
// "anulada" y la plata no se toca — metrics.ts ya descuenta la NC por su lado.

export const STATUS_TONE: Record<string, string> = {
  pendiente: "bg-yellow-100 text-yellow-800",
  parcial: "bg-blue-100 text-blue-800",
  pagada: "bg-green-100 text-green-800",
  anulada: "bg-gray-100 text-gray-500",
};

export function invoiceStatusBadge(
  status: string,
  opts: {
    // true = a esta factura se le aplicó el crédito de una NC.
    paidWithNc?: boolean;
    // true = es una NC (61) que ya se compensó (efectivo / banco / aplicada
    // a otra factura). Su estado interno queda "pagada", pero una NC no se
    // "paga" — se compensa. Mostramos "compensada" para que se entienda.
    isCompensatedNc?: boolean;
  } = {}
): { label: string; tone: string } {
  if (opts.isCompensatedNc) {
    return { label: "compensada", tone: "bg-blue-100 text-blue-800" };
  }
  if (status === "anulada" && opts.paidWithNc) {
    return { label: "pagada con NC", tone: "bg-green-100 text-green-800" };
  }
  return { label: status, tone: STATUS_TONE[status] || "bg-gray-100" };
}
