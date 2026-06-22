// Resuelve el concepto del cobro (obra | muebles | artefactos) de una factura
// EMITIDA, para saber qué genera sueldo (obra GG + muebles; artefactos no).
//
// HAY DOS CAMPOS, poblados inconsistentemente en el tiempo (verificado en prod
// 2026-06-22):
//   - `conceptoCobro` (legacy): en los proyectos VIEJOS tiene la clasificación
//     real (la marcaba la tarjeta "Utilidad por cobro" / el sync). Su categoría
//     quedó toda en "Obra" (default grueso del bulk-assign de gastos).
//   - `category` (CostCategory "Obra/Muebles/Artefactos"): en los proyectos
//     NUEVOS (ej. JNC) tiene la clasificación real, y `conceptoCobro` es null.
//
// Por eso priorizamos `conceptoCobro` cuando está seteado (proyectos viejos),
// y caemos a la categoría cuando no (proyectos nuevos). Así ninguno se rompe.
// Pendiente de fondo: unificar a UN solo campo (ver follow-up en docs/WIP).
export function conceptoDeFactura(inv: {
  category?: { name: string | null } | null;
  conceptoCobro?: string | null;
}): "obra" | "muebles" | "artefactos" | null {
  const c = inv.conceptoCobro;
  if (c === "obra" || c === "muebles" || c === "artefactos") return c;
  const cat = (inv.category?.name ?? "").toLowerCase();
  if (cat.includes("obra")) return "obra";
  if (cat.includes("mueble")) return "muebles";
  if (cat.includes("artefacto")) return "artefactos";
  return null;
}
