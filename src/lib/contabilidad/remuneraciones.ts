// Remuneraciones de BLARQ: empleados e indicadores del mes, leídos de la base.
//
// Antes vivían como constantes acá; ahora están en las tablas Empleado e
// IndicadorMensual (con pantalla editable en /contabilidad/remuneraciones). La
// UF/UTM del mes se traen automáticamente de internet (ver indicadores.ts).
//
// El sueldo de BLARQ es "base + bono" y el bono puede variar algún mes. Por
// default se usa el `Empleado.sueldoBase` (el estándar); si un mes cambió, un
// registro en SueldoMensual lo pisa solo para ese período (ver SueldoMensual).
//
// El motor de cálculo está en sueldos.ts (validado al peso vs liquidaciones
// reales). Acá solo se cargan los datos y se suma el código 048 que necesita
// el F29.

import { prisma } from "@/lib/prisma";
import {
  computeLiquidacion,
  type EmpleadoParams,
  type IndicadoresMes,
  type Liquidacion,
} from "./sueldos";

function claveMes(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function claveSueldo(empleadoId: string, year: number, month: number): string {
  return `${empleadoId}:${claveMes(year, month)}`;
}

// Empleado con su id (para resolver el override de sueldo del mes).
export type EmpleadoConId = EmpleadoParams & { id: string };

// Datos de remuneraciones precargados para computar varios meses sin pegarle a
// la base una vez por mes (lo usa el F29, que recorre los 12 meses del año).
export type RemuneracionesData = {
  empleados: EmpleadoConId[];
  indicadoresPorMes: Map<string, IndicadoresMes>;
  // `${empleadoId}:${year}-${month}` -> sueldo base+bono de ese mes (override).
  sueldosMensuales: Map<string, number>;
};

// Carga empleados activos + indicadores + ajustes de sueldo mensuales, todo de
// una sola vez.
export async function loadRemuneracionesData(): Promise<RemuneracionesData> {
  const [empleados, indicadores, sueldos] = await Promise.all([
    prisma.empleado.findMany({ where: { activo: true }, orderBy: { nombre: "asc" } }),
    prisma.indicadorMensual.findMany(),
    prisma.sueldoMensual.findMany(),
  ]);

  const indicadoresPorMes = new Map<string, IndicadoresMes>();
  for (const i of indicadores) {
    indicadoresPorMes.set(claveMes(i.year, i.month), {
      uf: i.uf,
      utm: i.utm,
      gratificacionTopeMensual: i.gratificacionTopeMensual,
      topeImponibleSaludUF: i.topeImponibleSaludUF,
    });
  }

  const sueldosMensuales = new Map<string, number>();
  for (const s of sueldos) {
    sueldosMensuales.set(claveSueldo(s.empleadoId, s.year, s.month), s.sueldoBase);
  }

  return {
    empleados: empleados.map(toEmpleadoConId),
    indicadoresPorMes,
    sueldosMensuales,
  };
}

function toEmpleadoConId(e: {
  id: string;
  nombre: string;
  rut: string;
  sueldoBase: number;
  colacion: number;
  movilizacion: number;
  afpComisionRate: number;
  isaprePlanUF: number;
}): EmpleadoConId {
  return {
    id: e.id,
    nombre: e.nombre,
    rut: e.rut,
    sueldoBase: e.sueldoBase,
    colacion: e.colacion,
    movilizacion: e.movilizacion,
    afpComisionRate: e.afpComisionRate,
    isaprePlanUF: e.isaprePlanUF,
  };
}

// Sueldo base+bono efectivo de un empleado en un mes: el override del mes si
// existe, si no el estándar del empleado.
function sueldoDelMes(
  data: RemuneracionesData,
  emp: EmpleadoConId,
  year: number,
  month: number
): number {
  return (
    data.sueldosMensuales.get(claveSueldo(emp.id, year, month)) ?? emp.sueldoBase
  );
}

// Código 048 del F29 a partir de datos ya cargados (sync). Devuelve null si no
// hay indicadores para ese mes (la pantalla lo muestra como pendiente, no $0).
export function codigo048From(
  data: RemuneracionesData,
  year: number,
  month: number
): number | null {
  const ind = data.indicadoresPorMes.get(claveMes(year, month));
  if (!ind) return null;
  return data.empleados.reduce((sum, emp) => {
    const sueldoBase = sueldoDelMes(data, emp, year, month);
    return sum + computeLiquidacion({ ...emp, sueldoBase }, ind).impuestoUnico;
  }, 0);
}

// Versión async de un solo mes — para usos que no precargan el año.
export async function computeCodigo048(
  year: number,
  month: number
): Promise<number | null> {
  const data = await loadRemuneracionesData();
  return codigo048From(data, year, month);
}

// Liquidaciones completas de un mes (para la pantalla de remuneraciones).
// Devuelve null si no hay indicadores cargados para ese mes. Cada liquidación
// usa el sueldo del mes (override si existe).
export async function getLiquidacionesMes(
  year: number,
  month: number
): Promise<{ liquidaciones: Liquidacion[]; indicadores: IndicadoresMes } | null> {
  const data = await loadRemuneracionesData();
  const indicadores = data.indicadoresPorMes.get(claveMes(year, month));
  if (!indicadores) return null;
  return {
    liquidaciones: data.empleados.map((emp) => {
      const sueldoBase = sueldoDelMes(data, emp, year, month);
      return computeLiquidacion({ ...emp, sueldoBase }, indicadores);
    }),
    indicadores,
  };
}

// Sueldo del mes por empleado, para la pantalla (efectivo + estándar + si está
// ajustado). Incluye a todos los empleados activos aunque no tengan override.
export async function getSueldosDelMes(
  year: number,
  month: number
): Promise<
  {
    empleadoId: string;
    nombre: string;
    rut: string;
    estandar: number;
    efectivo: number;
    ajustado: boolean;
  }[]
> {
  const [empleados, sueldos] = await Promise.all([
    prisma.empleado.findMany({ where: { activo: true }, orderBy: { nombre: "asc" } }),
    prisma.sueldoMensual.findMany({ where: { year, month } }),
  ]);
  const porEmpleado = new Map(sueldos.map((s) => [s.empleadoId, s.sueldoBase]));
  return empleados.map((e) => {
    const override = porEmpleado.get(e.id);
    return {
      empleadoId: e.id,
      nombre: e.nombre,
      rut: e.rut,
      estandar: e.sueldoBase,
      efectivo: override ?? e.sueldoBase,
      ajustado: override !== undefined,
    };
  });
}
