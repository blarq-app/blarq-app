// FUENTE ÚNICA de las categorías de MOVIMIENTO BANCARIO (BankMovement.category).
//
// ─── Por qué existen DOS vocabularios en la app (leer antes de "unificar") ───
//
// En la app conviven dos formas de categorizar, y es a propósito:
//
//   1. El ÁRBOL de categorías de costo (modelo CostCategory: Materiales, Mano
//      de obra, Herramientas, Auto, Gastos generales…) responde a la pregunta
//      "¿EN QUÉ se gastó?". Cuelga de la FACTURA (Invoice.categoryId).
//
//   2. Esta lista PLANA responde a otra pregunta: "¿QUÉ TIPO de movimiento es
//      este, y por qué no tiene factura?". Cuelga del MOVIMIENTO del banco.
//
// No se pisan, porque un movimiento conciliado contra una factura PIERDE su
// categoría (queda null): manda la factura. Nunca hay dos categorías para el
// mismo peso.
//
// Y la mayoría de los gastos sin documento YA entran al árbol: los pagos a
// maestros, las boletas y los gastos internacionales se registran como factura
// fantasma (tipoDoc 1043) con su CostCategory de verdad. O sea que el árbol
// sabe cubrir "gasto sin papel".
//
// Lo que queda solo de este lado son dos grupos:
//   · Gastos reales que NUNCA llegan como documento: sueldo, Previred,
//     comisión del banco. Para verlos junto a las facturas hay que traducirlos
//     al vocabulario del árbol — ese es el PUENTE (`seccionCosto`, abajo).
//   · Cosas que NO SON GASTO: retiros, préstamos y bonos de socios, depósitos
//     en efectivo, traspasos entre cuentas propias, reembolsos de proveedor.
//     Meter esto en el árbol de gastos inflaría el gastado. Por eso la lista
//     plana no se disuelve.
//
// Decisión y alternativas evaluadas: docs/decisions/2026-07-26-dos-vocabularios-de-categoria.md
//
// ─── Por qué este archivo ───
//
// Hasta 2026-07-26 esta lista estaba copiada a mano en CUATRO lugares que ya no
// coincidían entre sí (la pantalla de movimientos tenía dos copias, la de
// reglas una tercera con dos etiquetas distintas, y el Estado de Resultado una
// cuarta con un valor que las otras no tenían). Además el puente al vocabulario
// de las facturas estaba escrito a mano y por separado en cada pantalla que lo
// necesitaba. Ahora se deriva todo de acá.
//
// Este módulo NO importa prisma a propósito: lo consumen componentes de cliente
// (el desplegable de la tabla del banco), igual que banco/socios.ts.

export type CategoriaBanco = {
  /** Lo que se guarda en BankMovement.category. */
  value: string;
  /** Etiqueta corta: tabla del banco y listado de reglas. */
  label: string;
  /**
   * Etiqueta del desplegable, cuando necesita más explicación que la de la
   * tabla (la celda es angosta, el desplegable no). Si no está, se usa `label`.
   */
  labelOpcion?: string;
  /**
   * Cómo se llama la fila en el Estado de Resultado. Es un registro DISTINTO
   * del de la tabla, a propósito: ahí el nombre es contable y va en plural
   * ("Sueldos", "Gastos financieros", "Impuestos (SII)"). MJ lee este cuadro
   * como estado de resultado, no como listado de movimientos.
   */
  labelEERR: string;
  /**
   * ¿La elige MJ en el desplegable, o la escribe solo el sistema? Las de
   * sistema (traspaso interno, reembolso de proveedor) igual necesitan etiqueta
   * porque se muestran en la tabla y en el EERR.
   */
  seleccionable: boolean;
  /**
   * ¿Es un costo de operar BLARQ que hay que mostrar junto a las facturas en el
   * centro de costo del estudio? Solo tres categorías lo son.
   *
   * OJO — los impuestos quedan FUERA a propósito. El F29 es mayormente IVA, un
   * pasa-manos: lo cobrás al cliente, descontás el de compras y la diferencia
   * se la das al SII. No es costo de operar. Mismo criterio que los retiros y
   * préstamos de socios.
   */
  esGastoDeEstructura: boolean;
  /**
   * EL PUENTE al vocabulario de las facturas: bajo qué nombre aparece este
   * movimiento cuando se lo muestra al lado de los gastos con factura.
   *
   * "Gastos financieros" es el único caso donde el nombre existe de los dos
   * lados (la comisión del banco acá, y una CostCategory homónima allá) — y es
   * deliberado: así caen en la misma fila. "Sueldos" y "Previred" no son
   * CostCategory: son secciones que solo existen en el estado de resultado.
   *
   * Solo tiene valor cuando `esGastoDeEstructura` es true.
   */
  seccionCosto: string | null;
};

// El orden de este array ES el orden del desplegable de imputación.
export const CATEGORIAS_BANCO: CategoriaBanco[] = [
  {
    value: "sueldo",
    label: "Sueldo",
    labelEERR: "Sueldos",
    seleccionable: true,
    esGastoDeEstructura: true,
    seccionCosto: "Sueldos",
  },
  {
    // Cuenta corriente con los socios: préstamos y devoluciones en los dos
    // sentidos van todos acá, y el signo del movimiento hace el resto (ver
    // banco/socios.ts). No se separa "préstamo" de "devolución": la suma es igual.
    value: "prestamo_socio",
    label: "Préstamos socios",
    labelOpcion: "Préstamos socios (presta o devuelve)",
    labelEERR: "Préstamos de socios",
    seleccionable: true,
    esGastoDeEstructura: false,
    seccionCosto: null,
  },
  {
    value: "retiro_personal",
    label: "Retiro socio",
    labelEERR: "Retiros de socios",
    seleccionable: true,
    esGastoDeEstructura: false,
    seccionCosto: null,
  },
  {
    value: "bono_socio",
    label: "Bono socio",
    labelEERR: "Bonos a socios",
    seleccionable: true,
    esGastoDeEstructura: false,
    seccionCosto: null,
  },
  {
    value: "previred",
    label: "Previred",
    labelEERR: "Previred",
    seleccionable: true,
    esGastoDeEstructura: true,
    seccionCosto: "Previred",
  },
  {
    value: "comision_bancaria",
    label: "Comisión banco",
    labelEERR: "Gastos financieros",
    seleccionable: true,
    esGastoDeEstructura: true,
    seccionCosto: "Gastos financieros",
  },
  {
    value: "impuestos",
    label: "Impuestos",
    labelEERR: "Impuestos (SII)",
    seleccionable: true,
    esGastoDeEstructura: false, // pasa-manos, no costo de operar — ver arriba
    seccionCosto: null,
  },
  {
    value: "deposito_efectivo",
    label: "Depósito efectivo",
    labelEERR: "Depósito en efectivo",
    seleccionable: true,
    esGastoDeEstructura: false,
    seccionCosto: null,
  },
  {
    value: "otro_sin_factura",
    label: "Otro",
    labelEERR: "Otros sin factura",
    seleccionable: true,
    esGastoDeEstructura: false,
    seccionCosto: null,
  },
  // ─── Las escribe solo el sistema, no aparecen en el desplegable ───
  {
    // Traspaso entre dos cuentas de BLARQ (Operativa ↔ Sueldos). Lo detecta el
    // importador de cartolas emparejando los dos lados. Suma cero.
    value: "transfer_interno",
    label: "Transfer interno",
    labelEERR: "Traspaso interno",
    seleccionable: false,
    esGastoDeEstructura: false,
    seccionCosto: null,
  },
  {
    // Lo escribe la compensación de notas de crédito: el proveedor devuelve
    // plata. Ver facturas/[id]/compensar.
    value: "reembolso_proveedor",
    label: "Reembolso proveedor",
    labelEERR: "Reembolso de proveedor",
    seleccionable: false,
    esGastoDeEstructura: false,
    seccionCosto: null,
  },
];

// Nota: "compra_tarjeta" existió hasta 2026-07-26 en tres mapas de etiquetas,
// pero ningún camino del código la escribía desde que se sacó la inferencia por
// el prefijo "Compra" de la glosa (ver santanderParser.ts) y un script la limpió
// a null. Verificado en la base viva: 0 movimientos y 0 reglas con ese valor.
// Si reaparece, el movimiento se muestra con el texto crudo — no rompe nada.

const PORVALOR = new Map(CATEGORIAS_BANCO.map((c) => [c.value, c]));

export function categoriaBanco(value: string | null): CategoriaBanco | null {
  return value == null ? null : PORVALOR.get(value) ?? null;
}

/** ¿Es un valor que el código conoce? Lo usa la validación del PATCH. */
export function esCategoriaBancoValida(value: string): boolean {
  return PORVALOR.has(value);
}

/** Las que puede elegir MJ, en orden, para el desplegable y el filtro de columna. */
export const OPCIONES_IMPUTACION: { value: string; label: string }[] =
  CATEGORIAS_BANCO.filter((c) => c.seleccionable).map((c) => ({
    value: c.value,
    label: c.labelOpcion ?? c.label,
  }));

/** Etiqueta corta (tabla del banco, listado de reglas). */
export const ETIQUETA_CATEGORIA: Record<string, string> = Object.fromEntries(
  CATEGORIAS_BANCO.map((c) => [c.value, c.label])
);

/** Etiqueta contable (filas del Estado de Resultado). */
export const ETIQUETA_CATEGORIA_EERR: Record<string, string> = Object.fromEntries(
  CATEGORIAS_BANCO.map((c) => [c.value, c.labelEERR])
);

/**
 * Las categorías que son costo de operar BLARQ. Sirve para traer del banco los
 * gastos que no tienen factura y mostrarlos junto a las facturas en el centro
 * de costo del estudio.
 */
export const CATEGORIAS_GASTO_ESTRUCTURA: string[] = CATEGORIAS_BANCO.filter(
  (c) => c.esGastoDeEstructura
).map((c) => c.value);

/**
 * EL PUENTE: bajo qué sección del estado de resultado cae este movimiento
 * cuando se lo muestra al lado de los gastos con factura. null = no corresponde
 * mostrarlo ahí (no es costo de operar).
 */
export function seccionCostoDeCategoria(category: string | null): string | null {
  return categoriaBanco(category)?.seccionCosto ?? null;
}
