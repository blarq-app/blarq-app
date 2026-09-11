/**
 * Proveedores de herrajes.
 *
 * Hasta el 2026-09-11 eran dos pestañas fijas en la pantalla (DPH y HBT). MJ
 * pidió cargar herrajes de OTROS proveedores (ej. Carlos, su mueblista, que le
 * vende itemizado un herraje de una marca a la que ella no tiene acceso), así
 * que las pestañas se arman con los fijos más cualquier proveedor que exista
 * en el catálogo. En la base el proveedor siempre fue texto libre: lo fijo
 * estaba solo en la pantalla.
 *
 * Los fijos van primero y en ese orden (son los que tienen revisador de
 * precios / mayor volumen); el resto, alfabético. Pura, sin base de datos.
 */
export const PROVEEDORES_FIJOS = ["DPH", "HBT"] as const;

// Valor centinela del desplegable para "escribir un proveedor nuevo".
export const OTRO_PROVEEDOR = "__otro__";

// Nombre tal como se guarda: sin espacios sobrantes. NO cambia mayúsculas:
// el nombre sale así en el PDF al cliente, y cómo se escribe lo decide MJ.
export function normalizarProveedor(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

export function proveedoresDe(items: { supplier: string }[]): string[] {
  const fijos = new Set<string>(PROVEEDORES_FIJOS);
  const otros = new Set<string>();
  for (const it of items) {
    const s = normalizarProveedor(it.supplier ?? "");
    if (s && !fijos.has(s)) otros.add(s);
  }
  return [...PROVEEDORES_FIJOS, ...[...otros].sort((a, b) => a.localeCompare(b, "es"))];
}
