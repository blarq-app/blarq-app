// Cuentas de PRESENTACIÓN del Cuadro Resumen que antes vivían adentro de
// `CuadroResumenAvance.tsx`: el apilado de los pagos por columna, la fila
// AVANCE (lo que se pide con el % que tipea MJ) y "Me paso a Sueldos".
//
// Se sacaron del componente, SIN cambiarles nada, porque desde el pendiente 190
// hay un tercer lector además de la pantalla y la imagen: el Excel
// (`lib/xlsx/CuadroResumenXLSX.ts`). Si el Excel tuviera su propia copia de
// estas cuentas, tarde o temprano se separaría de lo que MJ ve — es el error
// que ya mordió entre la pantalla y la imagen (#389). Con un solo lugar, los
// tres no pueden diferir.
//
// OJO: esto NO es el cálculo contable. Acordado, cobrado, avance y saldo por
// concepto salen de `cuadroResumen.ts` (y ese de metrics.ts); acá solo se
// arma lo que depende del % objetivo que MJ pone en pantalla.

import type { ConceptoCuadro, ConceptoKey, PagoRow } from "@/lib/projects/cuadroResumen";

// Una transferencia interna Operativa→Sueldos conciliada a esta obra. Es el
// detalle de "Ya transferido": el usuario ve de qué está hecho ese total.
export type TransferenciaSueldo = {
  id: string;
  date: string; // ISO — se serializa en el server component
  amount: number;
  concepto: string | null; // "obra" | "muebles" | null (todavía sin marcar)
};

// Una celda de pago ya lista para pintar: el monto de UN concepto, la factura
// con que se cobró y la fecha en que entró. La fecha viaja en la celda (y no en
// la fila) porque cada columna se apila por su cuenta — ver `apilarPagos`.
export type CeldaPago = { monto: number; folio: string | null; date: Date };

export type FilaPagos = Partial<Record<ConceptoKey, CeldaPago>>;

export type TransferidoPorConcepto = { obra: number; muebles: number; sinConcepto: number };

export type AvanceConcepto = {
  aPedir: number;
  saldoNuevo: number;
  pctFinal: number;
  generado: number;
  transferido: number;
  faltaTransferir: number;
};

export type CalculoAvance = {
  porConcepto: Map<ConceptoKey, AvanceConcepto>;
  totalAPedir: number;
  totalSaldoNuevo: number;
  generadoTotal: number;
  aTransferir: number;
  transferidoDeMas: boolean;
};

// Totales por concepto de las transferencias a Sueldos — misma suma NETA que
// antes hacía el groupBy en el server (una devolución viene con monto negativo
// y netea sola).
export function sumarTransferido(transferencias: TransferenciaSueldo[]): TransferidoPorConcepto {
  const acc = { obra: 0, muebles: 0, sinConcepto: 0 };
  for (const t of transferencias) {
    if (t.concepto === "obra") acc.obra += t.amount;
    else if (t.concepto === "muebles") acc.muebles += t.amount;
    else acc.sinConcepto += t.amount;
  }
  return acc;
}

export function totalTransferido(t: TransferidoPorConcepto): number {
  return t.obra + t.muebles + t.sinConcepto;
}

// ── Fila AVANCE + Me paso a Sueldos ────────────────────────────────────────
// `avance` es el % OBJETIVO al que MJ quiere llegar, por concepto.
export function calcularAvance(
  conceptos: ConceptoCuadro[],
  avance: Record<string, number>,
  transferido: TransferidoPorConcepto
): CalculoAvance {
  const porConcepto = new Map<ConceptoKey, AvanceConcepto>();
  let totalAPedir = 0;
  let totalSaldoNuevo = 0;
  let generadoTotal = 0;
  for (const c of conceptos) {
    // El % es el OBJETIVO al que llegar. A pedir = lo que falta para llegar
    // a ese % (nunca negativo). Así 100% pide exactamente el saldo restante.
    const objetivo = (avance[c.key] ?? 0) / 100;
    const aPedir = Math.max(0, objetivo * c.acordado - c.pagado);
    const saldoNuevo = Math.max(0, c.acordado - c.pagado - aPedir);
    const pctFinal = c.acordado > 0 ? (c.pagado + aPedir) / c.acordado : 0;
    const generado = c.generaSueldo ? Math.min(1, pctFinal) * c.utilidad100 : 0;
    // Transferido por concepto (solo obra/muebles llevan sueldo).
    const transf =
      c.key === "obra" ? transferido.obra : c.key === "muebles" ? transferido.muebles : 0;
    const faltaTransferir = Math.max(0, generado - transf);
    porConcepto.set(c.key, {
      aPedir,
      saldoNuevo,
      pctFinal,
      generado,
      transferido: transf,
      faltaTransferir,
    });
    totalAPedir += aPedir;
    totalSaldoNuevo += saldoNuevo;
    generadoTotal += generado;
  }
  // A transferir total = lo generado menos TODO lo transferido (incl. lo sin
  // clasificar) — es el número real a traspasar.
  const transferidoTotal = totalTransferido(transferido);
  const aTransferir = Math.max(0, generadoTotal - transferidoTotal);
  const transferidoDeMas = transferidoTotal - generadoTotal > 1000;
  return { porConcepto, totalAPedir, totalSaldoNuevo, generadoTotal, aTransferir, transferidoDeMas };
}

// ── Pagos: cada columna de corrido, compactada hacia arriba ──────────────
//
// El cálculo (`computeCuadroResumen`) agrupa los pagos por FECHA EXACTA: una
// fila por día, y si un concepto no se cobró ese día su celda queda con
// guion. Eso se veía desordenado — en Paseo del Sena la obra tiene pagos el
// 08-06, 10-06, 29-06 y 06-07, y muebles solo los dos últimos, así que la
// columna MUEBLES arrancaba dos filas más abajo con dos huecos arriba.
//
// Acá reapilamos SOLO PARA MOSTRAR: cada concepto lista sus propios pagos en
// orden de fecha, sin huecos, y los guiones quedan al final (donde un
// concepto tiene menos pagos que otro). No se pierde nada: cada concepto ya
// trae su propia sub-columna FECHA, así que alinear por día no aportaba.
//
// Es un cambio de PRESENTACIÓN: los montos son los mismos, así que TOTAL
// PAGOS, AVANCE y SALDO (que se calculan aparte, sobre `conceptos`) no se
// mueven. Tampoco toca "Me paso a Sueldos", que comparte el mismo cálculo.
export function apilarPagos(conceptos: ConceptoCuadro[], pagos: PagoRow[]): FilaPagos[] {
  // `pagos` ya viene ordenado por fecha, así que filtrar preserva el orden.
  const columnas = conceptos.map((c) => ({
    key: c.key,
    celdas: pagos
      .filter((r) => r.porConcepto[c.key].monto)
      .map((r) => ({
        monto: r.porConcepto[c.key].monto,
        folio: r.porConcepto[c.key].folio,
        date: r.date,
      })),
  }));
  // Alto de la tabla = el concepto con más pagos.
  const alto = columnas.reduce((max, col) => Math.max(max, col.celdas.length), 0);
  return Array.from({ length: alto }, (_, i) => {
    const fila: FilaPagos = {};
    for (const col of columnas) if (col.celdas[i]) fila[col.key] = col.celdas[i];
    return fila;
  });
}

// ¿Hay algo que pedir en esta celda, o va el guion?
//
// Se redondea ANTES de decidir. `aPedir` sale de una resta con fracciones
// (el objetivo % por el acordado, menos lo pagado), así que un concepto YA
// cobrado al 100% no da 0 exacto sino una fracción de peso —en Paseo del
// Sena, 0,26 en Art. Sanitarios y 0,37 en Muebles—. Esa fracción pasaba el
// `> 0` de antes y la celda terminaba imprimiendo "$0", que es justo lo que
// la regla de la casa evita ("el cero no ocupa espacio prominente"), y en la
// imagen que le llega a la clienta.
//
// Se compara contra el peso ENTERO que se va a mostrar, que es lo que hace
// formatCLP: así la condición y lo impreso no pueden discrepar. Va como
// helper compartido a propósito — lo usan la pantalla, la imagen y el Excel,
// y si viviera duplicado se volverían a separar (#389).
export function hayQuePedir(v: number): boolean {
  return Math.round(v) > 0;
}

// Total de la fila AVANCE, en pesos ENTEROS — la suma de lo que realmente se
// muestra en cada celda, no de las fracciones. Con todos los conceptos ya
// cobrados al 100%, las fracciones sumaban 0,63 y la columna Total imprimía
// "$1" mientras cada celda decía "—": un total que no cierra con nada de lo
// que el cliente ve. NO toca el cálculo (`totalAPedir` sigue igual y es el que
// alimenta el saldo): es solo cómo se imprime esta celda.
export function totalAPedirMostrado(conceptos: ConceptoCuadro[], calc: CalculoAvance): number {
  return conceptos.reduce((suma, c) => suma + Math.round(calc.porConcepto.get(c.key)!.aPedir), 0);
}
