import { CAPITULOS } from "@/lib/presupuesto/chapters";
import { homologarCategoria } from "@/lib/catalog/homologarCategoria";

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

/**
 * Antigüedad de la última revisión de precio de un producto del catálogo.
 *
 * Por qué existe (auditoría 2026-07-31): el precio del catálogo solo se
 * actualiza cuando alguien corre "Revisar precios" a mano, pero las tiendas
 * cambian sus ofertas cuando quieren. En la base viva había 40 de 136 productos
 * con más de un mes sin revisar y la pantalla no lo mostraba en ningún lado, así
 * que no había forma de saber si el precio que se estaba cotizando era de ayer o
 * de hace dos meses. `vencido` marca el umbral a partir del cual conviene
 * revisar antes de mandar una cotización.
 */
export const DIAS_PRECIO_VENCIDO = 30;

export function edadRevisionPrecio(date: Date | string | null | undefined): {
  texto: string;
  dias: number | null;
  vencido: boolean;
} {
  if (!date) return { texto: "sin revisar", dias: null, vencido: true };
  const d = typeof date === "string" ? new Date(date) : date;
  const dias = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (dias < 1) return { texto: "revisado hoy", dias, vencido: false };
  if (dias === 1) return { texto: "revisado ayer", dias, vencido: false };
  if (dias < DIAS_PRECIO_VENCIDO)
    return { texto: `revisado hace ${dias} días`, dias, vencido: false };
  const meses = Math.floor(dias / 30);
  return {
    texto:
      meses <= 1
        ? "revisado hace más de un mes"
        : `revisado hace ${meses} meses`,
    dias,
    vencido: true,
  };
}

// Orden cronológico/lógico de cómo se ejecuta una obra: sirve para mostrar las
// categorías del catálogo de partidas en el orden en que realmente se trabajan,
// no alfabético. Las que no figuran quedan al final, ordenadas por nombre.
//
// Hasta 2026-08-03 esta era una lista propia, escrita a mano, DISTINTA de la de
// capítulos del presupuesto (CAPITULOS_SUGERIDOS). Nadie las mantuvo iguales y
// divergieron. Ahora hay UNA sola lista y vive del lado del presupuesto, porque
// esos nombres son los que salen en el PDF del cliente. Se re-exporta con el
// nombre viejo para no romper a quien la importe.
export const CATALOG_CATEGORY_ORDER = CAPITULOS;

// Compara dos categorías por su posición en la lista única.
//
// Los nombres se resuelven ANTES de comparar (homologarCategoria): mientras
// convivan en la base un nombre viejo y su reemplazo —entre el deploy y la
// migración de datos— los dos caen en la MISMA posición, en vez de que el viejo
// se vaya suelto al final de la pantalla.
export function compareCatalogCategories(a: string, b: string): number {
  const order = CAPITULOS as readonly string[];
  const ia = order.indexOf(homologarCategoria(a).categoria);
  const ib = order.indexOf(homologarCategoria(b).categoria);
  if (ia === -1 && ib === -1) return a.localeCompare(b);
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
}

// Los capítulos de obra ya NO viven acá. Eran 8 claves fijas (OBRA_CHAPTERS,
// hasta 2026-07-27) con nombre y orden hardcodeados: MJ no podía renombrarlos
// ni reordenarlos, y una partida cuya clave no calzaba con ninguna de las 8
// desaparecía del editor y del PDF sin dejar rastro.
//
// Ahora un capítulo es una fila propia de cada versión de presupuesto (modelo
// ObraChapter), con nombre libre y posición arrastrable — igual que los
// capítulos de muebles. La regla de agrupar y numerar vive en
// lib/presupuesto/chapters.ts, y los 8 nombres de siempre sobreviven ahí como
// SUGERENCIAS del botón "+ Capítulo" (CAPITULOS_SUGERIDOS).

export const BUDGET_STATUSES = {
  borrador: { label: "Borrador", color: "bg-gray-100 text-gray-800" },
  enviado: { label: "Enviado", color: "bg-blue-100 text-blue-800" },
  aprobado: { label: "Aprobado", color: "bg-green-100 text-green-800" },
  rechazado: { label: "Rechazado", color: "bg-red-100 text-red-800" },
} as const;

export type BudgetStatus = keyof typeof BUDGET_STATUSES;
