// Signo con el que un documento tributario entra a una SUMA de montos.
//
// Una nota de crédito (DTE 61) revierte una factura: tiene que RESTAR, no
// sumar. Vale para los dos lados — NC recibida = el proveedor nos devolvió
// plata; NC emitida = le devolvimos plata al cliente. El monto se guarda en
// positivo en la base, así que el signo lo pone quien suma.
//
// Las facturas anuladas NO se sacan de la suma: la anula su NC, y las dos se
// cancelan entre sí. Si además se excluyera la anulada, la NC restaría una
// factura que ya no está y el total quedaría corto. Caso que lo destapó
// (2026-10-02): BRUNE en Paseo del Sena — F-532 anulada + NC-20 por el mismo
// monto; sin signo la lista de Facturas mostraba $17.930.920 en vez de
// $7.877.800.
//
// FUENTE ÚNICA para las pantallas. Hoy la importan la lista de Facturas, la
// lista de facturas por proyecto y el Resumen del proyecto. Quedan con su
// propia copia, idéntica, `metrics.ts`, `estadoResultado.ts` y
// `fondoSueldos.ts`: son cálculos contables y moverlos pide snapshot antes y
// después (CLAUDE.md §4.1). Si se tocan, que importen de acá.
export function signoDte(inv: { tipoDoc: number | null }): 1 | -1 {
  return inv.tipoDoc === 61 ? -1 : 1;
}
