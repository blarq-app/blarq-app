// Remuneraciones de BLARQ: empleados e indicadores del mes, leídos de la base.
//
// Antes vivían como constantes acá; ahora están en las tablas Empleado e
// IndicadorMensual (con pantalla editable en /contabilidad/remuneraciones). La
// UF/UTM del mes se traen automáticamente de internet (ver indicadores.ts).
//
// El motor de cálculo está en sueldos.ts (validado al peso vs liquidaciones
// reales de mayo 2026). Acá solo se cargan los datos y se suma el código 048
// (impuesto único retenido) que necesita el F29.

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

// Empleado tal como vive en la base (incluye los campos informativos que el
// motor no usa pero la pantalla sí).
export type EmpleadoRow = EmpleadoParams & {
  id: string;
  afpNombre: string | null;
  isapreNombre: string | null;
  activo: boolean;
};

// Datos de remuneraciones precargados para computar varios meses sin pegarle a
// la base una vez por mes (lo usa el F29, que recorre los 12 meses del año).
export type RemuneracionesData = {
  empleados: EmpleadoParams[];
  indicadoresPorMes: Map<string, IndicadoresMes>;
};

// Carga empleados activos + todos los indicadores de una sola vez.
export async function loadRemuneracionesData(): Promise<RemuneracionesData> {
  const [empleados, indicadores] = await Promise.all([
    prisma.empleado.findMany({ where: { activo: true }, orderBy: { nombre: "asc" } }),
    prisma.indicadorMensual.findMany(),
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

  return {
    empleados: empleados.map(toEmpleadoParams),
    indicadoresPorMes,
  };
}

function toEmpleadoParams(e: {
  nombre: string;
  rut: string;
  sueldoBase: number;
  colacion: number;
  movilizacion: number;
  afpComisionRate: number;
  isaprePlanUF: number;
}): EmpleadoParams {
  return {
    nombre: e.nombre,
    rut: e.rut,
    sueldoBase: e.sueldoBase,
    colacion: e.colacion,
    movilizacion: e.movilizacion,
    afpComisionRate: e.afpComisionRate,
    isaprePlanUF: e.isaprePlanUF,
  };
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
  return data.empleados.reduce(
    (sum, emp) => sum + computeLiquidacion(emp, ind).impuestoUnico,
    0
  );
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
// Devuelve null si no hay indicadores cargados para ese mes.
export async function getLiquidacionesMes(
  year: number,
  month: number
): Promise<{ liquidaciones: Liquidacion[]; indicadores: IndicadoresMes } | null> {
  const data = await loadRemuneracionesData();
  const indicadores = data.indicadoresPorMes.get(claveMes(year, month));
  if (!indicadores) return null;
  return {
    liquidaciones: data.empleados.map((emp) =>
      computeLiquidacion(emp, indicadores)
    ),
    indicadores,
  };
}
