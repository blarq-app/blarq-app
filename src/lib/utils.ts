const clpFormatter = new Intl.NumberFormat("es-CL", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatCLP(amount: number): string {
  // Build manually to guarantee "$" is always adjacent (no NBSP/thin-space from Intl)
  return "$" + clpFormatter.format(Math.round(amount));
}

export function formatNumber(amount: number): string {
  return clpFormatter.format(Math.round(amount));
}

export function formatUF(amount: number): string {
  return `UF ${new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)}`;
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatPercent(value: number): string {
  return `${value}%`;
}

export const PROJECT_STATUSES = {
  cotizacion: { label: "Cotización", color: "bg-yellow-100 text-yellow-800" },
  aprobado: { label: "Aprobado", color: "bg-blue-100 text-blue-800" },
  en_ejecucion: { label: "En Ejecución", color: "bg-green-100 text-green-800" },
  terminado: { label: "Terminado", color: "bg-gray-100 text-gray-800" },
} as const;

export type ProjectStatus = keyof typeof PROJECT_STATUSES;

export const OBRA_CHAPTERS = {
  demoliciones: { label: "Demoliciones", index: 1 },
  reparaciones: { label: "Reparaciones", index: 2 },
  electricas: { label: "Eléctricas", index: 3 },
  sanitarias: { label: "Sanitarias", index: 4 },
  terminaciones: { label: "Terminaciones", index: 5 },
  limpieza: { label: "Limpieza", index: 6 },
} as const;

export type ObraChapter = keyof typeof OBRA_CHAPTERS;

export const BUDGET_STATUSES = {
  borrador: { label: "Borrador", color: "bg-gray-100 text-gray-800" },
  enviado: { label: "Enviado", color: "bg-blue-100 text-blue-800" },
  aprobado: { label: "Aprobado", color: "bg-green-100 text-green-800" },
  rechazado: { label: "Rechazado", color: "bg-red-100 text-red-800" },
} as const;

export type BudgetStatus = keyof typeof BUDGET_STATUSES;
