// Cotizaciones previsionales del mes (planilla Previred).
//
// Calcula, por trabajador y por institución, todo lo que BLARQ paga a Previred
// cada mes: la parte del trabajador (que ya sale en la liquidación) MÁS los
// aportes del empleador (SIS, cesantía patronal, seguro social de la reforma,
// mutual) que la liquidación no muestra.
//
// VALIDADO AL PESO contra la planilla pagada real de mayo 2026 (leída en
// Previred): AFP $752.705 · Isapre $720.109 · Seguro Social $42.659 ·
// Mutual $164.950. Tasas del documento oficial "Indicadores Previsionales
// PREVIRED" (remuneraciones mayo 2026).
//
// Cómo Previred agrupa el pago en 4 "instituciones":
//   AFP           = AFP trabajador (10% + comisión) + AFP empleador 0,1%
//                   + SIS 1,62% + Cesantía AFC (2,4% empleador + 0,6% trabajador)
//   Isapre        = salud (plan, mínimo 7%)
//   Seguro Social = reforma de pensiones 0,9% (empleador)
//   Mutual        = accidentes del trabajo (tasa propia de la empresa)

import { computeLiquidacion, type EmpleadoParams, type IndicadoresMes } from "./sueldos";

// Tasas del empleador (Indicadores Previsionales PREVIRED).
// OJO: algunas cambian de período (el SIS se ajusta ~trimestral; el aporte de
// la reforma sube año a año). Estas son las vigentes para remuneraciones de
// mayo 2026 en adelante; al cambiar de período hay que revisarlas.
export const TASA_AFP_EMPLEADOR = 0.001; // 0,1% cargo del empleador (AFP)
export const TASA_SIS = 0.0162; // 1,62% Seguro de Invalidez y Sobrevivencia
export const TASA_AFC_EMPLEADOR = 0.024; // 2,4% cesantía empleador (indefinido)
export const TASA_AFC_TRABAJADOR = 0.006; // 0,6% cesantía trabajador (indefinido)
export const TASA_SEGURO_SOCIAL = 0.009; // 0,9% reforma de pensiones (empleador)

// Tasa del Mutual: PROPIA de cada empresa (riesgo/siniestralidad). La de BLARQ
// (constructora) es 3,48%, deducida del pago real de mayo 2026. Editable porque
// la Mutualidad la recalcula periódicamente.
export const TASA_MUTUAL_BLARQ_DEFAULT = 0.0348;

export type CotizacionEmpleado = {
  nombre: string;
  rut: string;
  imponible: number;
  // Parte del trabajador (se descuenta del sueldo)
  afpTrabajador: number; // 10% + comisión
  saludTrabajador: number; // plan Isapre
  cesantiaTrabajador: number; // 0,6%
  // Parte del empleador (la paga BLARQ además del sueldo)
  afpEmpleador: number; // 0,1%
  sis: number; // 1,62%
  cesantiaEmpleador: number; // 2,4%
  seguroSocial: number; // 0,9% reforma
  mutual: number; // tasa propia
  // Agrupación por institución (lo que se paga a cada una)
  totalAFP: number;
  totalIsapre: number;
  totalSeguroSocial: number;
  totalMutual: number;
  totalEmpleado: number; // todo lo de este trabajador
};

export type PlanillaPrevired = {
  empleados: CotizacionEmpleado[];
  // Totales por institución (lo que BLARQ paga a cada una)
  totalAFP: number;
  totalIsapre: number;
  totalSeguroSocial: number;
  totalMutual: number;
  totalGeneral: number;
  tasaMutual: number;
};

// Calcula la cotización Previred de un trabajador en el mes.
export function computeCotizacion(
  emp: EmpleadoParams,
  ind: IndicadoresMes,
  tasaMutual: number
): CotizacionEmpleado {
  const liq = computeLiquidacion(emp, ind);
  const imp = liq.totalImponible;

  const afpTrabajador = liq.totalAfp;
  const saludTrabajador = liq.totalSalud;
  const cesantiaTrabajador = liq.cesantia;

  const afpEmpleador = Math.round(imp * TASA_AFP_EMPLEADOR);
  const sis = Math.round(imp * TASA_SIS);
  const cesantiaEmpleador = Math.round(imp * TASA_AFC_EMPLEADOR);
  const seguroSocial = Math.round(imp * TASA_SEGURO_SOCIAL);
  const mutual = Math.round(imp * tasaMutual);

  // Agrupación Previred
  const totalAFP =
    afpTrabajador + afpEmpleador + sis + cesantiaEmpleador + cesantiaTrabajador;
  const totalIsapre = saludTrabajador;
  const totalSeguroSocial = seguroSocial;
  const totalMutual = mutual;

  return {
    nombre: emp.nombre,
    rut: emp.rut,
    imponible: imp,
    afpTrabajador,
    saludTrabajador,
    cesantiaTrabajador,
    afpEmpleador,
    sis,
    cesantiaEmpleador,
    seguroSocial,
    mutual,
    totalAFP,
    totalIsapre,
    totalSeguroSocial,
    totalMutual,
    totalEmpleado: totalAFP + totalIsapre + totalSeguroSocial + totalMutual,
  };
}

// Planilla completa del mes para un conjunto de empleados.
export function computePlanillaPrevired(
  empleados: EmpleadoParams[],
  ind: IndicadoresMes,
  tasaMutual: number = TASA_MUTUAL_BLARQ_DEFAULT
): PlanillaPrevired {
  const cots = empleados.map((e) => computeCotizacion(e, ind, tasaMutual));
  const sum = (f: (c: CotizacionEmpleado) => number) =>
    cots.reduce((s, c) => s + f(c), 0);

  const totalAFP = sum((c) => c.totalAFP);
  const totalIsapre = sum((c) => c.totalIsapre);
  const totalSeguroSocial = sum((c) => c.totalSeguroSocial);
  const totalMutual = sum((c) => c.totalMutual);

  return {
    empleados: cots,
    totalAFP,
    totalIsapre,
    totalSeguroSocial,
    totalMutual,
    totalGeneral: totalAFP + totalIsapre + totalSeguroSocial + totalMutual,
    tasaMutual,
  };
}
