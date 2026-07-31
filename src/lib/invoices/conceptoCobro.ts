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

// ── Facturas COMBINADAS ────────────────────────────────────────────────────
//
// Hay clientas que piden UN solo documento por todo (obra + muebles +
// artefactos). Portofino (#60) es el caso que lo destapó: sus 4 facturas
// mezclan los tres, y como una factura pertenecía a un solo concepto, el
// Cuadro Resumen las mandaba enteras a la columna Obra y dejaba muebles y
// artefactos en 0% aunque estuvieran cobrados.
//
// Ahora la factura puede traer el reparto cargado a mano en 5 montos (con
// IVA, sumando el total del documento). Si CUALQUIERA de los cinco está
// seteado, manda el desglose; si los cinco son null, no hay desglose y el
// llamador sigue con el comportamiento de siempre.

export type ConceptoDetalle = "obra" | "muebles" | "cocina" | "sanitarios" | "iluminacion";

export type DesgloseCobro = Record<ConceptoDetalle, number>;

export type FacturaConDesglose = {
  montoObra?: number | null;
  montoMuebles?: number | null;
  artefactoCocina?: number | null;
  artefactoSanitario?: number | null;
  artefactoIluminacion?: number | null;
};

/** ¿La factura tiene el reparto entre conceptos cargado a mano? */
export function tieneDesgloseCobro(inv: FacturaConDesglose): boolean {
  return (
    inv.montoObra != null ||
    inv.montoMuebles != null ||
    inv.artefactoCocina != null ||
    inv.artefactoSanitario != null ||
    inv.artefactoIluminacion != null
  );
}

/**
 * El reparto de la factura entre los 5 conceptos, o null si no lo tiene
 * cargado. Los campos vacíos se leen como 0: si MJ llenó obra y muebles y dejó
 * los de artefactos en blanco, es porque esa factura no cobra artefactos.
 */
export function desgloseDeCobro(inv: FacturaConDesglose): DesgloseCobro | null {
  if (!tieneDesgloseCobro(inv)) return null;
  return {
    obra: inv.montoObra ?? 0,
    muebles: inv.montoMuebles ?? 0,
    cocina: inv.artefactoCocina ?? 0,
    sanitarios: inv.artefactoSanitario ?? 0,
    iluminacion: inv.artefactoIluminacion ?? 0,
  };
}
