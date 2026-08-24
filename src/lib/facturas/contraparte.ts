import { formatRutForDisplay } from "@/lib/clients/rut";

/**
 * Quién es "el otro" en una factura, para mostrarlo en las listas.
 *
 * El RUT que le importa a MJ NO es siempre el mismo campo: en una factura
 * EMITIDA el emisor es BLARQ (siempre el mismo RUT, no aporta nada) y lo que
 * quiere ver es el cliente → rutReceiver. En una RECIBIDA es al revés: el
 * proveedor es el emisor → rutIssuer. Esta función encapsula esa regla para
 * que los cuatro lugares donde se dibuja la celda (lista general en tarjeta y
 * en tabla, lista por proyecto en tarjeta y en tabla) no la repitan cada uno.
 */
export type ContraparteInput = {
  type: string;
  businessName: string | null;
  rutIssuer: string | null;
  rutReceiver: string | null;
};

export function contraparteDeFactura(inv: ContraparteInput): {
  nombre: string;
  rut: string | null;
} {
  const rutCrudo = inv.type === "emitida" ? inv.rutReceiver : inv.rutIssuer;
  const rut = rutCrudo ? formatRutForDisplay(rutCrudo) || rutCrudo : null;

  // Sin razón social (gastos internacionales, boletas), el RUT —si lo hay—
  // sube a ocupar el renglón del nombre en vez de repetirse arriba y abajo.
  // Si no hay ninguno de los dos, queda el guion y no se inventa nada.
  if (!inv.businessName) return { nombre: rut ?? "—", rut: null };

  return { nombre: inv.businessName, rut };
}
