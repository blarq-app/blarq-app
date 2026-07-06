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
//   DESCUENTOS LEGALES (sobre el imponible)
//   − AFP: 10% capitalización + comisión de la AFP (Planvital 1,16%)
//   − Salud: el plan de Isapre en UF (mínimo legal 7% del imponible)
//   − Seguro de cesantía: 0,6% (parte trabajador, contrato indefinido)
//   − Impuesto único de 2da categoría (por tramos en UTM)
//
//   LÍQUIDO = Total haberes − total descuentos legales
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

  // AFP
  const afpCapitalizacion = Math.round(totalImponible * AFP_CAPITALIZACION);
  const afpComision = Math.round(totalImponible * emp.afpComisionRate);
  const totalAfp = afpCapitalizacion + afpComision;

  // Salud: el plan completo en UF se descuenta del líquido.
  const saludLegal = Math.round(totalImponible * SALUD_LEGAL);
  const totalSalud = Math.round(emp.isaprePlanUF * ind.uf);
  const saludAdicional = totalSalud - saludLegal;

  // Cesantía
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
