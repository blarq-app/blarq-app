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
  ejecucion: { label: "En Ejecución", color: "bg-green-100 text-green-800" },
  terminado: { label: "Terminado", color: "bg-gray-100 text-gray-800" },
  archivado: { label: "Archivada", color: "bg-gray-100 text-gray-500" },
} as const;

export type ProjectStatus = keyof typeof PROJECT_STATUSES;

// Helpers de fecha relativa para tablas tipo "última actividad"
export function relativeDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 1) return "hoy";
  if (diffDays === 1) return "ayer";
  if (diffDays < 30) return `hace ${diffDays}d`;
  // >30d → fecha absoluta corta
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short" });
}

// Orden cronológico/lógico de cómo se ejecuta una obra. Sirve para
// mostrar las categorías del catálogo de partidas en el orden en que
// realmente se trabajan, no alfabético. Categorías que no figuran en
// esta lista quedan al final, ordenadas por nombre.
export const CATALOG_CATEGORY_ORDER = [
  "OBRAS PRELIMINARES",
  "DEMOLICIONES",
  "REPARACIONES",
  "OBRA GRUESA",
  "AISLACION E IMPERMEABILIZACION",
  "INSTALACIONES ELECT.",
  "INSTALACIONES SANITARIAS",
  "INSTALACIONES GAS",
  "CLIMATIZACION",
  "TERMINACIONES",
  "MUEBLES",
  "ASEO Y LIMPIEZA",
] as const;

// Compara dos categorías según su posición en CATALOG_CATEGORY_ORDER.
// Las desconocidas van al final, alfabéticas entre sí.
export function compareCatalogCategories(a: string, b: string): number {
  const order = CATALOG_CATEGORY_ORDER as readonly string[];
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  if (ia === -1 && ib === -1) return a.localeCompare(b);
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
}

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
