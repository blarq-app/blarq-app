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
export const SOCIOS = [
  { rut: "18022887", nombre: "José Tomás" },
  { rut: "18023983", nombre: "María José" },
] as const;
export const SOCIO_RUTS: string[] = SOCIOS.map((s) => s.rut); // JT y MJ
export const SOCIO_NOMBRES = ["jose tomas lar", "maria jose blanco", "maría josé blanco"];

// Fragmentos cortos como aparecen TRUNCADOS en la glosa del banco
// ("Transf a Maria Jose Bla"). Son AMPLIOS a propósito: sirven solo para
// LISTAR/filtrar transferencias a socios en la UI, no para clasificar plata
// (eso lo hace esSocio, que se apoya en el RUT). No usar para categorizar.
export const SOCIO_GLOSA_HINTS = ["maria jose", "jose tomas"];

// Financiamiento entre BLARQ y un socio. Son DOS relaciones, según QUIÉN es el
// que presta; dentro de cada una, el SIGNO del movimiento dice si crea o salda
// la deuda. Con eso quedan los cuatro casos reales sin re-etiquetar lo viejo
// (decidido con MJ 2026-07-18):
//
//   prestamo_socio (el SOCIO le presta a BLARQ — caso camioneta 2022):
//       entra plata → el socio presta   → BLARQ le debe
//       sale plata  → BLARQ le devuelve  → baja lo que BLARQ debe  ("Devolución")
//   adelanto_socio (BLARQ le presta al SOCIO — caso Rojas Mella):
//       sale plata  → BLARQ adelanta     → el socio le debe
//       entra plata → el socio devuelve  → baja lo que el socio debe
//
// Los movimientos viejos ya están en `prestamo_socio` y se leen igual que
// siempre (una salida = devolución); no hay que tocarlos. `adelanto_socio` es
// el rótulo nuevo, solo para cuando BLARQ es el que financia.
// OJO: esto NO es la "Devolución (neto cero)" del banco — esa es para un pago
// por error que vuelve entero y se cancela solo. Acá el saldo queda vivo.
//
// Viven acá —y no en estadoResultadoCaja— porque este módulo es seguro para el
// cliente: estadoResultadoCaja importa prisma, y usarlo desde la tabla del
// banco arrastraría prisma al bundle del browser.
export const CATEGORIA_PRESTAMO_SOCIO = "prestamo_socio";
export const CATEGORIA_ADELANTO_SOCIO = "adelanto_socio";
export function esCategoriaFinanciamientoSocio(category: string | null): boolean {
  return (
    category === CATEGORIA_PRESTAMO_SOCIO ||
    category === CATEGORIA_ADELANTO_SOCIO
  );
}

// Rótulo para la fila del banco: el signo dice si el movimiento crea o salda la
// deuda, así una devolución NO se lee como "préstamo" (era la queja de MJ).
export function labelFinanciamientoSocio(
  category: string | null,
  amount: number
): string | null {
  if (category === CATEGORIA_PRESTAMO_SOCIO) {
    return amount < 0 ? "Devolución a socio" : "Préstamo del socio";
  }
  if (category === CATEGORIA_ADELANTO_SOCIO) {
    return amount < 0 ? "Adelanto a socio" : "Devolución del socio";
  }
  return null;
}

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
  const porRut = SOCIOS.find((s) => r.includes(s.rut));
  if (porRut) return porRut.nombre;
  const t = (nombre ?? "").toLowerCase();
  if (t.includes("jose tomas")) return "José Tomás";
  if (t.includes("maria jose") || t.includes("maría josé")) return "María José";
  return nombre?.trim() || "Socio";
}

// ¿A qué socio pertenece un préstamo/devolución? Normalmente la contraparte del
// banco ES el socio (transferencia directa a MJ / JT). Pero cuando BLARQ le paga
// a un TERCERO por cuenta de un socio (caso real: $500k a Rojas Mella porque JT
// no tenía plata en su cuenta), la glosa dice el tercero y el banco no puede
// saber solo que la deuda es de JT — eso lo marca MJ a mano con `socioRut`.
//
// Devuelve null cuando no se puede determinar: la contraparte no es socio y
// nadie marcó el socio todavía. La UI usa ese null para pedirle a MJ que lo
// diga ("¿de qué socio?"), en vez de atribuirle el saldo al tercero.
export function socioDeMovimiento(
  socioRut: string | null,
  counterpartyRut: string | null,
  counterpartyName: string | null,
  desc: string | null
): string | null {
  if (socioRut) return nombreSocio(socioRut, null);
  if (esSocio(counterpartyRut, counterpartyName, desc)) {
    return nombreSocio(counterpartyRut, counterpartyName);
  }
  return null;
}
