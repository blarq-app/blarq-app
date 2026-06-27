// Datos de remuneraciones de BLARQ: empleados e indicadores del mes.
//
// NOTA: por ahora estos datos viven como constantes en el código (BLARQ tiene
// solo 2 empleados: MJ y JT). El paso siguiente es moverlos a la base de datos
// con una pantalla para editarlos y traer la UF/UTM/topes automáticamente. Esta
// versión sirve para conectar el cálculo al F29 (código 048) y validarlo.
//
// El motor de cálculo está en sueldos.ts (validado al peso vs liquidaciones
// reales de mayo 2026).

import {
  computeLiquidacion,
  type EmpleadoParams,
  type IndicadoresMes,
} from "./sueldos";

export const EMPLEADOS: EmpleadoParams[] = [
  {
    nombre: "José Tomás Larraín",
    rut: "18.022.887-K",
    sueldoBase: 1924126,
    colacion: 150000,
    movilizacion: 150000,
    afpComisionRate: 0.0116, // Planvital
    isaprePlanUF: 3.864, // Colmena
  },
  {
    nombre: "María José Blanco",
    rut: "18.023.983-9",
    sueldoBase: 2389125,
    colacion: 150000,
    movilizacion: 150000,
    afpComisionRate: 0.0116, // Planvital
    isaprePlanUF: 13.868, // Colmena
  },
];

// Indicadores por mes (clave "YYYY-MM"). UF/UTM del mes, tope de gratificación
// (4,75 IMM / 12) y tope imponible para la rebaja de salud del impuesto.
// topeImponibleSaludUF=90 está calibrado contra la liquidación real de mayo;
// confirmar contra el tope oficial al cargar más meses.
export const INDICADORES_POR_MES: Record<string, IndicadoresMes> = {
  "2026-05": {
    uf: 40610.69,
    utm: 70588,
    gratificacionTopeMensual: 213354,
    topeImponibleSaludUF: 90,
  },
};

function claveMes(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

// Código 048 del F29 = impuesto único retenido de los sueldos del mes. Devuelve
// null si no hay indicadores cargados para ese mes (la pantalla lo muestra como
// pendiente en vez de $0).
export function computeCodigo048(year: number, month: number): number | null {
  const ind = INDICADORES_POR_MES[claveMes(year, month)];
  if (!ind) return null;
  return EMPLEADOS.reduce(
    (sum, emp) => sum + computeLiquidacion(emp, ind).impuestoUnico,
    0
  );
}
