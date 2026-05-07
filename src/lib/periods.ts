// Helpers para calcular rangos de períodos para EERR.
//
// Un período tiene un rango actual [start, end] y un rango anterior
// (mismo tamaño, justo antes) para comparación.

export type Period = "month" | "semester" | "year" | "custom";

export type PeriodRange = {
  current: { start: Date; end: Date; label: string };
  previous: { start: Date; end: Date; label: string };
};

const MONTHS_ES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

function fmtDay(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}-${MONTHS_ES[d.getMonth()]}-${d.getFullYear().toString().slice(2)}`;
}

function fmtMonth(d: Date): string {
  return `${MONTHS_ES[d.getMonth()]} ${d.getFullYear().toString().slice(2)}`;
}

// `now` parametrizable para testeo. End = "today" inclusivo (con hora 23:59:59).
export function computePeriodRange(
  period: Period,
  customFrom?: string,
  customTo?: string,
  now: Date = new Date()
): PeriodRange {
  const today = new Date(now);
  today.setHours(23, 59, 59, 999);

  let start: Date;
  let end = new Date(today);

  switch (period) {
    case "month": {
      // 1° del mes actual hasta hoy
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    }
    case "semester": {
      // Rolling 6 meses: 1° del mes hace 5 meses (incluye el actual) hasta hoy.
      // Ejemplo: si hoy es mayo, semestre = dic-ene-feb-mar-abr-may.
      start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      break;
    }
    case "year": {
      // Año completo en curso
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      break;
    }
    case "custom": {
      start = customFrom ? new Date(customFrom + "T00:00:00") : new Date(now.getFullYear(), now.getMonth(), 1);
      end = customTo ? new Date(customTo + "T23:59:59.999") : new Date(today);
      break;
    }
  }
  start.setHours(0, 0, 0, 0);

  // Período anterior: mismo "tipo" desplazado hacia atrás
  let prevStart: Date;
  let prevEnd: Date;

  switch (period) {
    case "month": {
      prevStart = new Date(start.getFullYear(), start.getMonth() - 1, 1);
      prevEnd = new Date(start.getFullYear(), start.getMonth(), 0, 23, 59, 59, 999); // último día del mes anterior
      break;
    }
    case "semester": {
      // Semestre anterior: 6 meses justo antes del actual.
      prevStart = new Date(start.getFullYear(), start.getMonth() - 6, 1);
      prevEnd = new Date(start.getFullYear(), start.getMonth(), 0, 23, 59, 59, 999);
      break;
    }
    case "year": {
      prevStart = new Date(now.getFullYear() - 1, 0, 1);
      prevEnd = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
      break;
    }
    case "custom": {
      // Mismo tamaño justo antes
      const ms = end.getTime() - start.getTime();
      prevEnd = new Date(start.getTime() - 1);
      prevStart = new Date(prevEnd.getTime() - ms);
      break;
    }
  }
  prevStart.setHours(0, 0, 0, 0);

  // Labels
  function labelFor(s: Date, e: Date): string {
    if (period === "month") return fmtMonth(s);
    if (period === "year") return String(s.getFullYear());
    if (period === "semester") return `${fmtMonth(s)} – ${fmtMonth(e)}`;
    return `${fmtDay(s)} – ${fmtDay(e)}`;
  }

  return {
    current: { start, end, label: labelFor(start, end) },
    previous: { start: prevStart, end: prevEnd, label: labelFor(prevStart, prevEnd) },
  };
}
