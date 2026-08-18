// Reparto de una Nota de Crédito entre sus destinos. Funciones PURAS (sin BD),
// para que la misma cuenta la hagan la pantalla, la API y los diagnósticos.
//
// Una NC es plata que el proveedor te devuelve. Puede irse a tres lados:
//   - a otra factura del mismo proveedor (baja lo que le debés),
//   - de vuelta a tu cuenta bancaria,
//   - en efectivo (no queda rastro trazable, solo la marca).
// Hasta 2026-08-17 la app admitía UN destino por NC. La realidad no siempre es
// así: la NC de Comercial Hispano por la mercadería devuelta ($143.471) pagó la
// factura del retiro ($26.637) y el resto ($116.834) volvió en un depósito.
//
// El segundo problema que resuelve este módulo es el TOPE. Antes, aplicar una NC
// a una factura sumaba la NC completa sin mirar cuánto debía esa factura: una NC
// de $39.222 sobre una factura de $22.491 la dejaba "pagada" y los $16.731 de
// diferencia desaparecían sin dejar rastro. Acá lo que excede el saldo de la
// factura no se evapora: sale por `sinRepartir`, que la pantalla muestra.

// Lo mínimo que hace falta saber de una NC para repartirla.
export type NCParaRepartir = {
  totalAmount: number; // las NC se guardan con signo variable — se usa abs
  compensationType: string | null;
  appliedToInvoiceId: string | null;
  appliedAmount: number | null; // null = "va todo a la factura"
  refundBankMovementId: string | null;
  refundAmount: number | null; // null = "vuelve todo al banco"
};

export type RepartoNC = {
  total: number;
  /** Lo que efectivamente salda la factura destino (topeado a su saldo). */
  aFactura: number;
  /** Lo que volvió por el banco. */
  alBanco: number;
  /** Devuelto en efectivo — consume la NC entera, sin destino trazable. */
  enEfectivo: number;
  /** Lo que no llegó a ningún lado. Si es > 0, algo falta de explicar. */
  sinRepartir: number;
};

// CLP no tiene decimales, pero los montos llegan como float desde la API del
// SII. El mismo peso de tolerancia que usan recomputeInvoiceStatus y
// statusPorImputacion.
const TOLERANCIA = 1;

/**
 * Cómo se reparte una NC entre sus destinos.
 *
 * `saldoFacturaDestino` es lo que la factura de destino todavía debe (su total
 * menos lo ya pagado por banco). Es el TOPE de lo que la NC puede saldar ahí:
 * una NC no puede dejar una factura pagada "de más". Pasar Infinity cuando no
 * interesa topear (ej. al validar un reparto que el usuario acaba de escribir).
 */
export function repartoDeNC(
  nc: NCParaRepartir,
  saldoFacturaDestino: number
): RepartoNC {
  const total = Math.abs(nc.totalAmount);

  const enEfectivo = nc.compensationType === "cash_refund" ? total : 0;

  const pedidoAFactura = nc.appliedToInvoiceId
    ? (nc.appliedAmount ?? total)
    : 0;
  const aFactura = Math.max(0, Math.min(pedidoAFactura, saldoFacturaDestino));

  const alBanco = nc.refundBankMovementId ? (nc.refundAmount ?? total) : 0;

  const sinRepartir = Math.max(0, total - aFactura - alBanco - enEfectivo);

  return {
    total,
    aFactura,
    alBanco,
    enEfectivo,
    sinRepartir: sinRepartir <= TOLERANCIA ? 0 : sinRepartir,
  };
}

/**
 * Valida un reparto que se está por guardar: los pedazos tienen que sumar el
 * total de la NC, ser positivos, y ninguno puede quedar en cero (para eso están
 * los modos de un solo destino). Devuelve el mensaje de error o null si está OK.
 *
 * El mensaje va tal cual a la pantalla — está escrito para MJ, no para un log.
 */
export function validarSplit(
  totalNC: number,
  aFactura: number,
  alBanco: number
): string | null {
  const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
  const total = Math.abs(totalNC);

  if (!Number.isFinite(aFactura) || !Number.isFinite(alBanco)) {
    return "Los montos tienen que ser números.";
  }
  if (aFactura <= 0 || alBanco <= 0) {
    return (
      "Los dos pedazos tienen que tener monto. Si la nota de crédito va " +
      "entera a un solo lado, usá la opción de ese destino en vez de partirla."
    );
  }
  const suma = aFactura + alBanco;
  if (Math.abs(suma - total) > TOLERANCIA) {
    const dif = suma - total;
    return (
      `Los dos pedazos suman ${clp(suma)} y la nota de crédito es de ` +
      `${clp(total)}: ${dif > 0 ? "sobran" : "faltan"} ${clp(Math.abs(dif))}.`
    );
  }
  return null;
}

/**
 * Cuánto de una NC vuelve por un movimiento bancario dado. Un mismo depósito
 * puede traer NCs de VARIAS obras — el de Comercial Hispano del 14-ago ($133.565)
 * trae la de JNC-Vitacura y la de Portofino juntas — así que cada NC aporta su
 * pedazo y el movimiento se salda con la suma.
 */
export function aporteAlMovimiento(nc: NCParaRepartir): number {
  if (!nc.refundBankMovementId) return 0;
  return nc.refundAmount ?? Math.abs(nc.totalAmount);
}
