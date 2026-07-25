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

// CUENTA DE PRÉSTAMOS CON LOS SOCIOS — una sola cuenta corriente, como en
// contabilidad de verdad (idea de MJ, 2026-07-18; es más simple y dice lo mismo
// que el intento anterior de separar "préstamo" de "devolución").
//
// Toda la plata que se mueve entre BLARQ y los socios por financiamiento va a
// ESTA categoría, y el SIGNO hace todo el trabajo:
//
//   entra plata (el socio pone / devuelve)  → BLARQ les debe MÁS
//   sale plata  (BLARQ devuelve / adelanta) → BLARQ les debe MENOS
//
// Da igual si el movimiento es "un préstamo" o "una devolución": la suma es la
// misma. Por eso NO hace falta distinguirlos — el saldo corrido dice la verdad:
// positivo = BLARQ les debe; negativo = los socios le deben a BLARQ.
//
// Por ahora la cuenta es de "los socios" en conjunto, sin separar por persona
// (decisión de MJ: no lo separaría todavía). El campo BankMovement.socioRut
// queda en el schema, sin uso, por si más adelante se quiere abrir por socio.
//
// OJO: esto NO es la "Devolución (neto cero)" del banco — esa es para un pago
// por error que vuelve entero y se cancela solo. Acá el saldo queda vivo.
//
// Vive acá —y no en estadoResultadoCaja— porque este módulo es seguro para el
// cliente: estadoResultadoCaja importa prisma, y usarlo desde la tabla del
// banco arrastraría prisma al bundle del browser.
export const CATEGORIA_PRESTAMO_SOCIO = "prestamo_socio";
export function esCategoriaFinanciamientoSocio(category: string | null): boolean {
  return category === CATEGORIA_PRESTAMO_SOCIO;
}

// TODAS las categorías que significan "plata hacia/desde un socio" (el import
// las sugiere cuando la contraparte es MJ / JT). Un movimiento NO puede ser al
// mismo tiempo pago-a-socio Y estar conciliado a una factura de proveedor: si
// se concilia, es un REEMBOLSO (el socio adelantó un gasto del negocio) y la
// factura manda. Por eso al conciliar se le borra cualquiera de estas
// categorías (ver auto-match en invoicePayments.ts; los caminos manuales ya
// limpiaban toda la categoría). Definida acá, en el módulo seguro para el
// cliente, para que sea la fuente única de "qué es pago a socio".
export const CATEGORIAS_PAGO_SOCIO = [
  "sueldo",
  "retiro_personal",
  "bono_socio",
  CATEGORIA_PRESTAMO_SOCIO,
] as const;
export function esCategoriaPagoSocio(category: string | null): boolean {
  return category != null && (CATEGORIAS_PAGO_SOCIO as readonly string[]).includes(category);
}

// Cuánto le debía BLARQ a los socios cuando empezamos a registrar. Es la
// camioneta que los socios financiaron en 2022 ($14.000.000, dato de MJ
// 2026-07-18). Los movimientos de ese préstamo original NO están en el banco
// —son de antes de la app—, así que sin este número de partida el saldo
// arrancaría en cero y mostraría que los socios le deben plata a BLARQ, que es
// justo al revés. Si aparece el monto exacto, se corrige acá.
export const SALDO_INICIAL_PRESTAMOS_SOCIOS = 14_000_000;

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
