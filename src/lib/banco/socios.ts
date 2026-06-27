// Socios de BLARQ — definición ÚNICA de "quién es socio", para que el import
// de cartolas y el Estado de Resultado (vista Caja) usen el mismo criterio y
// no se desincronicen. Antes la lista vivía duplicada en estadoResultadoCaja.ts.
//
// Por qué importa: una transferencia hacia un socio (MJ / JT) NO es, por
// default, un "sueldo". Puede ser un reembolso (le devuelven algo que pagó de
// su bolsillo, y eso se concilia contra la factura del proveedor), un bono, o
// un retiro de utilidades. Por eso el import dejó de archivarla sola como
// "sueldo / sin factura" — la deja como sugerencia para que MJ la confirme.
//
// Se detecta por RUT (lo más confiable) o, de respaldo, por nombre en la glosa.
export const SOCIO_RUTS = ["18022887", "18023983"]; // JT y MJ
export const SOCIO_NOMBRES = ["jose tomas lar", "maria jose blanco", "maría josé blanco"];

// Fragmentos cortos como aparecen TRUNCADOS en la glosa del banco
// ("Transf a Maria Jose Bla"). Son AMPLIOS a propósito: sirven solo para
// LISTAR/filtrar transferencias a socios en la UI, no para clasificar plata
// (eso lo hace esSocio, que se apoya en el RUT). No usar para categorizar.
export const SOCIO_GLOSA_HINTS = ["maria jose", "jose tomas"];

export function esSocio(
  rut: string | null,
  nombre: string | null,
  desc: string | null
): boolean {
  const r = (rut ?? "").replace(/\D/g, "");
  if (SOCIO_RUTS.some((s) => r.includes(s))) return true;
  const t = `${nombre ?? ""} ${desc ?? ""}`.toLowerCase();
  return SOCIO_NOMBRES.some((n) => t.includes(n));
}

// Nombre legible de un socio, para el saldo de préstamos. Resuelve por RUT
// (lo más confiable); si no, cae al nombre de la glosa del banco. Se usa solo
// para etiquetar el recuadro de saldos, no para clasificar plata.
export function nombreSocio(rut: string | null, nombre: string | null): string {
  const r = (rut ?? "").replace(/\D/g, "");
  if (r.includes("18022887")) return "José Tomás";
  if (r.includes("18023983")) return "María José";
  const t = (nombre ?? "").toLowerCase();
  if (t.includes("jose tomas")) return "José Tomás";
  if (t.includes("maria jose") || t.includes("maría josé")) return "María José";
  return nombre?.trim() || "Socio";
}
