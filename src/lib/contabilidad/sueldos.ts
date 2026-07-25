// Cálculo de liquidaciones de sueldo (remuneraciones).
//
// Reproduce la liquidación mensual de cada trabajador igual que el contador
// (validado al peso contra las liquidaciones reales de BLARQ, mayo 2026:
// José Tomás Larraín y María José Blanco).
//
// Sirve para dos cosas del módulo de contabilidad:
//   1. Llenar el código 048 del F29 (impuesto único retenido del mes) = suma
//      del impuesto único de las liquidaciones del mes.
//   2. Base para Previred (AFP + salud + seguro de cesantía por trabajador).
//
// Estructura de la liquidación chilena (sueldo mensualizado, contrato
// indefinido, sin variables ni ausencias):
//
//   HABERES
//     Sueldo base                         (parámetro del trabajador)
//   + Gratificación legal = min(25% sueldo base, tope 4,75 IMM/12)
//   = Total imponible
//   + Colación + movilización             (no imponible, no tributable)
//   = Total haberes
//
//   DESCUENTOS LEGALES (sobre el imponible, CAPADO en el tope de 90 UF para
//   AFP y el 7% de salud; ver nota del tope más abajo)
//   − AFP: 10% capitalización + comisión de la AFP (Planvital 1,16%)
//   − Salud: el plan de Isapre en UF (mínimo legal 7% del imponible)
//   − Seguro de cesantía: 0,6% (parte trabajador, contrato indefinido)
//   − Impuesto único de 2da categoría (por tramos en UTM)
//
//   LÍQUIDO = Total haberes − total descuentos legales
//
// Tope imponible previsional (90 UF): AFP y el 7% legal de salud NO se calculan
// sobre el imponible completo sino sobre la renta capada en 90 UF. Para sueldos
// bajo ese techo no cambia nada; muerde recién cuando el imponible cruza las
// 90 UF (caso MJ junio 2026). La cesantía usa su propio tope, más alto, que hoy
// no muerde a ningún sueldo de BLARQ.
//
// Detalle fino del impuesto único: la base NO descuenta toda la salud, solo el
// 7% obligatorio + la parte adicional del plan hasta un tope (7% del tope
// imponible). Por eso quien tiene un plan caro (MJ) tributa sobre una base más
// alta que su líquido sugiere.

export type EmpleadoParams = {
  nombre: string;
  rut: string;
  sueldoBase: number;
  colacion: number;
  movilizacion: number;
  afpComisionRate: number; // ej. 0.0116 (Planvital)
  isaprePlanUF: number; // plan de salud en UF (ej. 3.8640)
};

export type IndicadoresMes = {
  uf: number; // valor UF del mes (último día / el que use la liquidación)
  utm: number; // valor UTM del mes
  gratificacionTopeMensual: number; // 4,75 × IMM / 12 (tope gratificación)
  topeImponibleSaludUF: number; // tope para el 7% deducible de impuesto (UF)
};

// Constantes legales estables (no cambian mes a mes).
const AFP_CAPITALIZACION = 0.1; // 10%
const SALUD_LEGAL = 0.07; // 7%
const CESANTIA_TRABAJADOR = 0.006; // 0,6% contrato indefinido
const GRATIFICACION_PORC = 0.25; // 25% de la remuneración

// Tabla del impuesto único de 2da categoría (mensual), tramos en UTM.
// factor y rebaja según SII; la UTM del mes la actualiza el valor monetario.
// impuesto = max(0, base × factor − rebaja × UTM).
const TRAMOS_IMPUESTO: { hastaUTM: number; factor: number; rebajaUTM: number }[] =
  [
    { hastaUTM: 13.5, factor: 0, rebajaUTM: 0 },
    { hastaUTM: 30, factor: 0.04, rebajaUTM: 0.54 },
    { hastaUTM: 50, factor: 0.08, rebajaUTM: 1.74 },
    { hastaUTM: 70, factor: 0.135, rebajaUTM: 4.49 },
    { hastaUTM: 90, factor: 0.23, rebajaUTM: 11.14 },
    { hastaUTM: 120, factor: 0.304, rebajaUTM: 17.804 },
    { hastaUTM: 310, factor: 0.35, rebajaUTM: 23.324 },
    { hastaUTM: Infinity, factor: 0.4, rebajaUTM: 38.824 },
  ];

export function impuestoUnico(basePesos: number, utm: number): number {
  const baseUTM = basePesos / utm;
  const tramo =
    TRAMOS_IMPUESTO.find((t) => baseUTM <= t.hastaUTM) ??
    TRAMOS_IMPUESTO[TRAMOS_IMPUESTO.length - 1];
  return Math.max(0, Math.round(basePesos * tramo.factor - tramo.rebajaUTM * utm));
}

export type Liquidacion = {
  nombre: string;
  rut: string;
  // Haberes
  sueldoBase: number;
  gratificacion: number;
  totalImponible: number;
  colacion: number;
  movilizacion: number;
  totalNoImponible: number;
  totalHaberes: number;
  // Descuentos
  afpCapitalizacion: number;
  afpComision: number;
  totalAfp: number;
  saludLegal: number; // 7%
  saludAdicional: number; // plan − 7%
  totalSalud: number; // plan completo
  cesantia: number;
  baseImpuesto: number;
  impuestoUnico: number;
  totalDescuentos: number;
  // Resultado
  liquido: number;
};

// ─── Gross-up: del líquido al imponible (liquidación al revés) ────────────
//
// Dado un LÍQUIDO objetivo (lo que MJ quiere pagar), encuentra el sueldo base
// que, tras los descuentos de computeLiquidacion, da justo ese líquido.
//
// El impuesto único es progresivo, así que no hay fórmula cerrada: se hace por
// búsqueda binaria sobre el sueldo base. El líquido crece de forma monótona con
// el base (el descuento marginal —AFP + cesantía + impuesto— nunca llega al
// 100%; la salud es un plan fijo en UF que no escala con el sueldo), así que la
// bisección converge. Trabaja en pesos enteros (el base se guarda entero) y
// devuelve el base cuyo líquido queda más cerca del objetivo (tolerancia ~$1
// por los redondeos internos de cada descuento).
//
// `emp.sueldoBase` se IGNORA — es el valor que estamos despejando.
export function grossUpFromLiquido(
  emp: EmpleadoParams,
  ind: IndicadoresMes,
  targetLiquido: number
): { sueldoBase: number; liquidacion: Liquidacion } {
  const liqOf = (base: number) =>
    computeLiquidacion({ ...emp, sueldoBase: base }, ind).liquido;

  // Cota superior amplia; se duplica si por algún parámetro extremo no bastara.
  let lo = 0;
  let hi = Math.max(targetLiquido, 0) * 4 + 5_000_000;
  while (liqOf(hi) < targetLiquido && hi < 1e12) hi *= 2;

  // Base entera más chica cuyo líquido alcanza (>=) el objetivo.
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (liqOf(mid) >= targetLiquido) hi = mid;
    else lo = mid + 1;
  }

  // Por los redondeos, el vecino de abajo puede quedar aún más cerca: comparamos
  // lo-1, lo y lo+1 y nos quedamos con el de menor diferencia al objetivo.
  let best = lo;
  let bestDiff = Infinity;
  for (const b of [lo - 1, lo, lo + 1]) {
    if (b < 0) continue;
    const d = Math.abs(liqOf(b) - targetLiquido);
    if (d < bestDiff) {
      bestDiff = d;
      best = b;
    }
  }

  return {
    sueldoBase: best,
    liquidacion: computeLiquidacion({ ...emp, sueldoBase: best }, ind),
  };
}

export function computeLiquidacion(
  emp: EmpleadoParams,
  ind: IndicadoresMes
): Liquidacion {
  // Haberes
  const gratificacion = Math.min(
    Math.round(emp.sueldoBase * GRATIFICACION_PORC),
    ind.gratificacionTopeMensual
  );
  const totalImponible = emp.sueldoBase + gratificacion;
  const totalNoImponible = emp.colacion + emp.movilizacion;
  const totalHaberes = totalImponible + totalNoImponible;

  // Tope imponible previsional: AFP y el 7% legal de salud se calculan sobre la
  // renta imponible CAPADA en el tope legal (90 UF), no sobre el imponible
  // completo. Para sueldos bajo el tope no cambia nada (imponibleTopado ==
  // totalImponible); recién muerde cuando el imponible cruza las 90 UF. Así
  // calza al peso con la liquidación del contador (validado MJ junio 2026).
  // La cesantía tiene un tope propio más alto (~131 UF) que hoy no muerde a
  // ningún sueldo de BLARQ, así que se sigue calculando sobre el imponible pleno
  // (igual que el contador).
  const imponibleTopado = Math.min(
    totalImponible,
    Math.round(ind.topeImponibleSaludUF * ind.uf)
  );

  // AFP (sobre el imponible topado)
  const afpCapitalizacion = Math.round(imponibleTopado * AFP_CAPITALIZACION);
  const afpComision = Math.round(imponibleTopado * emp.afpComisionRate);
  const totalAfp = afpCapitalizacion + afpComision;

  // Salud: el 7% legal se calcula sobre el imponible topado; el plan completo en
  // UF se descuenta igual del líquido (el adicional es la diferencia).
  const saludLegal = Math.round(imponibleTopado * SALUD_LEGAL);
  const totalSalud = Math.round(emp.isaprePlanUF * ind.uf);
  const saludAdicional = totalSalud - saludLegal;

  // Cesantía (sobre el imponible pleno, ver nota del tope arriba)
  const cesantia = Math.round(totalImponible * CESANTIA_TRABAJADOR);

  // Impuesto único: la base descuenta AFP + salud (capada al 7% del tope
  // imponible) + cesantía. La salud adicional rebaja la base solo hasta ese
  // tope; el exceso del plan no es deducible para impuesto.
  const topeSaludPesos = ind.topeImponibleSaludUF * ind.uf;
  const saludDeducible = Math.min(totalSalud, Math.round(topeSaludPesos * SALUD_LEGAL));
  const baseImpuesto = totalImponible - totalAfp - saludDeducible - cesantia;
  const impuesto = impuestoUnico(baseImpuesto, ind.utm);

  const totalDescuentos = totalAfp + totalSalud + cesantia + impuesto;
  const liquido = totalHaberes - totalDescuentos;

  return {
    nombre: emp.nombre,
    rut: emp.rut,
    sueldoBase: emp.sueldoBase,
    gratificacion,
    totalImponible,
    colacion: emp.colacion,
    movilizacion: emp.movilizacion,
    totalNoImponible,
    totalHaberes,
    afpCapitalizacion,
    afpComision,
    totalAfp,
    saludLegal,
    saludAdicional,
    totalSalud,
    cesantia,
    baseImpuesto,
    impuestoUnico: impuesto,
    totalDescuentos,
    liquido,
  };
}
