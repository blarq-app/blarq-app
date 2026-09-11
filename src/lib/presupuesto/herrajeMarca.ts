/**
 * Qué marca de un herraje se le muestra al CLIENTE.
 *
 * El catálogo de herrajes trae `brand`, pero se cargó por tandas y en la
 * mayoría de las líneas de DPH la "marca" es el propio distribuidor ("DPH"),
 * que no es una marca: es a quién le compra BLARQ. Al cliente eso no le dice
 * nada (y le muestra un proveedor). Las marcas de verdad (Blum, Hettich…) sí
 * le importan: son las que reconoce y las que justifican el precio.
 *
 * Regla: la marca sale si existe y NO es el nombre del proveedor de la línea
 * (comparación sin mayúsculas ni espacios). Pura, sin base de datos.
 */
export function marcaParaCliente(
  brand: string | null | undefined,
  supplier: string | null | undefined,
): string | null {
  const b = (brand ?? "").trim();
  if (!b) return null;
  const s = (supplier ?? "").trim();
  if (s && b.toUpperCase() === s.toUpperCase()) return null;
  return b;
}
