// A qué MES corresponde un pago de sueldo o Previred, para el Estado de
// Resultados de BLARQ.
//
// Problema: la plata sale del banco cuando MJ transfiere, que suele caer en el
// filo del mes o en el mes siguiente (el sueldo de junio pagado el 1-jul, la
// planilla Previred de mayo pagada en junio). Si el EERR agrupa por la fecha
// del movimiento, un mes sale vacío y el siguiente doble. Queremos agrupar por
// el mes que CORRESPONDE.
//
// El mes correcto lo fija MJ a mano (campo BankMovement.salaryPeriod, formato
// "YYYY-MM"). Cuando no lo marcó (null), usamos un default razonable por fecha
// y categoría, para que casi nunca tenga que tocarlo:
//   - Previred: SIEMPRE el mes anterior al pago (la planilla es del mes previo).
//   - Sueldo:   pagado del 1 al 10 → mes anterior; del 11 en adelante → ese mes.
//     (MJ paga el sueldo base en el filo del mes; los primeros días son el mes
//      que recién terminó.)
// Otras categorías no tienen "mes que corresponde": se agrupan por su fecha.

// "YYYY-MM" de una fecha, en UTC (las fechas de movimiento se guardan a
// medianoche UTC; usamos UTC en todo el cálculo para no correr de mes).
export function toYearMonth(date: Date): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

// Resta n meses a un "YYYY-MM".
export function shiftYearMonth(ym: string, deltaMonths: number): string {
  const [y, m] = ym.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
  return toYearMonth(base);
}

// Primer día del mes "YYYY-MM" a medianoche UTC — para reubicar el gasto en la
// columna correcta del EERR (que agrupa por fecha).
export function yearMonthToDate(ym: string): Date {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

// Default por fecha y categoría, cuando MJ no marcó el mes.
export function defaultSalaryPeriod(category: string | null, date: Date): string {
  const ym = toYearMonth(date);
  if (category === "previred") return shiftYearMonth(ym, -1);
  if (category === "sueldo") return date.getUTCDate() <= 10 ? shiftYearMonth(ym, -1) : ym;
  return ym;
}

// Mes efectivo al que se imputa el movimiento: el override si existe, si no el
// default. Solo tiene sentido para sueldo/previred; para el resto devuelve el
// mes de la propia fecha.
export function effectiveSalaryPeriod(mov: {
  category: string | null;
  date: Date;
  salaryPeriod: string | null;
}): string {
  return mov.salaryPeriod ?? defaultSalaryPeriod(mov.category, mov.date);
}
