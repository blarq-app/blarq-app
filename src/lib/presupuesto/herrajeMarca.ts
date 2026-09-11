/**
 * Qué se le muestra al CLIENTE junto a cada herraje: el PROVEEDOR de esa
 * línea (DPH, HBT…), porque MJ compra cada herraje a un proveedor distinto y
 * quiere que el cliente lo vea línea por línea (pedido del 2026-09-11, Los
 * Algarrobos). Si el catálogo además trae una marca de verdad (Blum, Hettich…),
 * va delante del proveedor; en la mayoría de las líneas de DPH el campo
 * "marca" del catálogo repite el distribuidor y ahí no se duplica.
 *
 * Pura, sin base de datos. Devuelve "" si no hay nada que mostrar.
 */
export function proveedorParaCliente(
  supplier: string | null | undefined,
  brand: string | null | undefined,
): string {
  const s = (supplier ?? "").trim();
  const b = (brand ?? "").trim();
  const partes: string[] = [];
  if (b && b.toUpperCase() !== s.toUpperCase()) partes.push(b);
  if (s) partes.push(s);
  return partes.join(" · ");
}
