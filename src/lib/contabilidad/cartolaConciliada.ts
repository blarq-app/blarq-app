// Cartola conciliada del mes, para el contador (pendiente 196).
//
// MJ le manda cada mes la cartola del banco a su contador (Externaliza). Él la
// recibe CRUDA y solo puede conciliar los movimientos cuyo monto calza exacto
// con una factura: no sabe que una transferencia de $7.000.000 pagó tres
// facturas, ni que la F183 se pagó en siete transferencias, ni que los
// $2.400.000 a MJ son el reembolso de una compra a Comercial K y no plata para
// ella. La app ya lo sabe, porque MJ concilia cada movimiento. Este módulo se lo
// ENTREGA: la cartola completa, en el orden del banco, y al lado de cada
// movimiento con qué se concilia.
//
// El mismo documento sale por mes o por AÑO COMPLETO (pedido de MJ, 2026-10-07):
// en el del año van todos los movimientos del año, con la cuadratura mes a mes.
//
// Decidido con MJ (la primera maqueta, con saldos y porcentajes arriba, no se
// entendió): la CARTOLA VA PRIMERO; los saldos van al final, chiquitos, como
// respaldo. Todos los movimientos, no solo los raros, y los pendientes se
// MUESTRAN, no se esconden.
//
// Este archivo es PURO (no lee la base): recibe lo que junta
// `cartolaConciliadaDatos.ts` y devuelve las filas ya explicadas. Así lo pueden
// usar el Excel, el PDF y la pantalla con la misma cuenta, y se prueba sin base
// (scripts/test-cartola-conciliada.ts).
//
// NO TOCA PLATA NI DATOS. No calcula nada contable propio:
//   - el estado de cada movimiento sale de su `status` (fuente única:
//     banco/movementStatus.ts) con el mismo rótulo que la pantalla del banco
//     (deriveEstado en banco/movementDisplay.ts);
//   - el mes de un sueldo o de Previred sale de banco/salaryPeriod.ts;
//   - quién es socio sale de banco/socios.ts;
//   - "cuánto le queda" a una factura repite la cuenta de recomputeInvoiceStatus
//     (pagos + notas de crédito aplicadas, con el mismo tope).
// Lo único que agrega es la FRASE que explica cada movimiento.

import { formatCLP } from "@/lib/utils";
import { MOV_STATUS } from "@/lib/banco/movementStatus";
import { deriveEstado } from "@/lib/banco/movementDisplay";
import { effectiveSalaryPeriod, shiftYearMonth, toYearMonth } from "@/lib/banco/salaryPeriod";
import { esSocio, nombreSocio } from "@/lib/banco/socios";
import { categoriaBanco } from "@/lib/banco/categorias";
import { retencionHonorario, tasaRetencionHonorarios } from "@/lib/contabilidad/honorarios";

// ─── Lo que entra (lo arma cartolaConciliadaDatos.ts) ───────────────────────

export type DocumentoCartola = {
  id: string;
  type: string; // emitida | recibida
  tipoDoc: number | null;
  folioNumber: string | null;
  rutIssuer: string | null;
  rutReceiver: string | null;
  businessName: string | null;
  totalAmount: number;
  origin: string | null;
  status: string;
  issueDate: Date;
};

export type MovimientoCartolaInput = {
  id: string;
  cuentaId: string;
  date: Date;
  description: string;
  amount: number; // con signo: negativo = cargo
  balanceAfter: number | null;
  status: string;
  category: string | null;
  counterpartyName: string | null;
  counterpartyRut: string | null;
  salaryPeriod: string | null;
  netZeroGroupId: string | null;
  netZeroAmount: number | null;
  // El otro lado de un traspaso entre cuentas BLARQ (cualquiera de los dos
  // sentidos del link).
  parInternoId: string | null;
  projectName: string | null;
  internalConcepto: string | null;
  pagos: { invoiceId: string; amountApplied: number }[];
  // Notas de crédito cuya plata volvió por este movimiento, con su pedazo.
  ncDevueltas: { invoiceId: string; monto: number }[];
};

// Movimientos de FUERA del período que hace falta nombrar: el par de un traspaso,
// la otra mitad de una devolución neto cero, las transferencias de otros meses
// que pagaron una factura de este mes.
export type MovimientoReferido = {
  id: string;
  cuentaId: string;
  date: Date;
  amount: number;
  description: string;
  netZeroGroupId: string | null;
  netZeroAmount: number | null;
};

export type CuentaCartolaInput = {
  id: string;
  alias: string;
  accountNumber: string;
  // Saldo de la cartola al cierre del último día ANTES del período (ver
  // saldoAlCierre). null = la cuenta no tiene movimientos antes.
  saldoInicialBanco: number | null;
};

export type DatosCartola = {
  year: number;
  // 1..12, o null para el AÑO COMPLETO (mismo documento, con todos los meses).
  month: number | null;
  cuentas: CuentaCartolaInput[]; // en el orden en que se muestran
  movimientos: MovimientoCartolaInput[]; // los del período, todas las cuentas
  referidos: MovimientoReferido[];
  documentos: DocumentoCartola[];
  // TODOS los pagos de los documentos tocados en el período, de cualquier fecha.
  pagosDeDocumentos: { invoiceId: string; bankMovementId: string; amountApplied: number }[];
  // Notas de crédito aplicadas a esos documentos (appliedToInvoiceId).
  ncAplicadas: { invoiceId: string; folio: string | null; monto: number }[];
  // Personas de la planilla de remuneraciones (Empleado), para saber si un
  // "sueldo" va a alguien que de verdad tiene liquidación.
  empleados: { rut: string; nombre: string }[];
};

// ─── Lo que sale ────────────────────────────────────────────────────────────

export type EstadoCartola = "Conciliado" | "Parcial" | "Pendiente";

export type Aplicacion = {
  documentoId: string;
  documento: string; // "Factura", "Boleta", "Pago sin respaldo"…
  folio: string | null; // null en el pago sin respaldo (su folio SR- es interno)
  rut: string | null; // con puntos y guion
  razonSocial: string | null;
  aplicado: number;
};

export type FilaCartola = {
  n: number; // correlativo del período; ata la cartola con la hoja por factura
  movimientoId: string;
  fecha: Date;
  cuenta: string;
  descripcion: string;
  cargo: number | null; // positivo
  abono: number | null; // positivo
  saldo: number;
  estado: EstadoCartola;
  queEs: string;
  detalle: string | null;
  aplicaciones: Aplicacion[];
  // Lo que todavía no tiene explicación (parcial o pendiente). 0 = nada.
  sinExplicar: number;
};

export type CuadraturaCuenta = {
  cuenta: string;
  numero: string;
  saldoInicial: number;
  entradas: number;
  salidas: number;
  saldoCalculado: number; // saldoInicial + entradas − salidas
  saldoFinalBanco: number; // el de la cartola
  diferencia: number; // saldoFinalBanco − saldoCalculado (0 = cuadra)
  movimientos: number;
};

// En el documento del año, la misma cuadratura mes a mes: si algo no cuadra,
// dice EN QUÉ MES.
export type CuadraturaMes = CuadraturaCuenta & { month: number };

export type PagoDeFactura = {
  fecha: Date;
  cuenta: string;
  n: number | null; // N° en esta cartola; null si es de fuera del período
  descripcion: string;
  montoTransferencia: number; // el movimiento entero, con signo
  aplicado: number;
  leQueda: number; // después de este pago
};

export type FacturaPartida = {
  documentoId: string;
  documento: string;
  folio: string | null;
  rut: string | null;
  razonSocial: string | null;
  lado: "venta" | "compra";
  fechaEmision: Date;
  total: number;
  anulada: boolean;
  pagos: PagoDeFactura[];
  notasCredito: { folio: string | null; monto: number }[];
  // Boleta de honorarios: BLARQ le paga el LÍQUIDO a la persona y la retención
  // se la entera al SII en el F29. No es plata que falte pagar. 0 si no aplica.
  retencion: number;
  retencionTasa: number | null;
  leQueda: number;
};

export type CartolaConciliada = {
  year: number;
  month: number | null; // null = año completo
  periodo: string; // "julio 2026" o "año 2026"
  esAño: boolean;
  // Primer y último movimiento del período (null si no hay ninguno). En el año
  // en curso, `hasta` dice hasta qué día llegan las cartolas cargadas.
  desde: Date | null;
  hasta: Date | null;
  filas: FilaCartola[];
  cuadratura: CuadraturaCuenta[];
  cuadraturaPorMes: CuadraturaMes[]; // solo en el documento del año
  facturasPartidas: FacturaPartida[];
  resumen: {
    movimientos: number;
    conciliados: number;
    parciales: number;
    pendientes: number;
  };
};

// ─── Ayudas ─────────────────────────────────────────────────────────────────

export const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

// CLP no tiene decimales pero la API devuelve floats: el mismo peso de
// tolerancia que movementStatus y recomputeInvoiceStatus.
const TOLERANCIA = 1;

// Orden canónico del importador de cartolas (santanderParser.ts): fecha, monto,
// descripción. El banco lista los movimientos de un mismo día en distinto orden
// según el formato de la cartola, así que el orden DENTRO del día no es dato;
// el saldo al cierre de cada día sí, y ese es el que respeta este orden.
export function ordenCanonico(
  a: { date: Date; amount: number; description: string },
  b: { date: Date; amount: number; description: string }
): number {
  const d = a.date.getTime() - b.date.getTime();
  if (d !== 0) return d;
  if (a.amount !== b.amount) return a.amount - b.amount;
  return a.description.localeCompare(b.description);
}

type ConSaldo = { date: Date; amount: number; description: string; balanceAfter: number | null };

/**
 * Saldo de la cartola al cierre de un DÍA, leído de los saldos que guardó el
 * importador (balanceAfter). Recibe los movimientos de ese día.
 *
 * Con un movimiento es su saldo. Con varios, NO alcanza con tomar el último
 * del orden canónico: cuando dos movimientos del día tienen el mismo monto
 * (30-dic-2025, Sueldos: −$750.000 a JT y −$750.000 a MJ), el desempate es por
 * descripción y la que quedó guardada no siempre es la que usó el import, así
 * que el "último" puede ser el del medio y la cuadratura muestra un descuadre
 * que no existe ($750.000 en dic y −$750.000 en ene). Por eso se busca el
 * saldo que de verdad cierra la cadena del día: el que, restándole todo lo
 * del día, deja un saldo de apertura desde el que los saldos guardados se
 * encadenan uno tras otro. Si ninguno encadena (falta o sobra un movimiento),
 * vuelve al último del orden canónico y la diferencia se ve en la cuadratura.
 */
export function saldoAlCierre(delDia: ConSaldo[]): number | null {
  const conSaldo = delDia.filter((m) => m.balanceAfter != null);
  if (conSaldo.length === 0) return null;
  const canonico = [...conSaldo].sort(ordenCanonico);
  if (conSaldo.length === 1 || conSaldo.length !== delDia.length) {
    return canonico[canonico.length - 1].balanceAfter;
  }
  const sumaDia = delDia.reduce((s, m) => s + m.amount, 0);
  const encadena = (cierre: number): boolean => {
    let actual = cierre - sumaDia;
    const quedan = [...conSaldo];
    while (quedan.length) {
      const i = quedan.findIndex((m) => Math.abs(actual + m.amount - m.balanceAfter!) <= TOLERANCIA);
      if (i < 0) return false;
      actual = quedan[i].balanceAfter!;
      quedan.splice(i, 1);
    }
    return Math.abs(actual - cierre) <= TOLERANCIA;
  };
  const candidatos = Array.from(new Set(conSaldo.map((m) => m.balanceAfter!))).filter(encadena);
  if (candidatos.length === 1) return candidatos[0];
  return canonico[canonico.length - 1].balanceAfter;
}

// Los movimientos del último día de una lista ya ordenada por fecha.
function delUltimoDia<T extends { date: Date }>(movs: T[]): T[] {
  if (movs.length === 0) return [];
  const ultimo = movs[movs.length - 1].date.getTime();
  return movs.filter((m) => m.date.getTime() === ultimo);
}

// Orden en que se MUESTRA la cartola: por fecha y, dentro del día, primero lo
// que entra y después lo que sale (de mayor a menor). Como el banco no fija el
// orden dentro del día, se elige uno que no muestre saldos negativos que no
// existieron: el 01-jul la cuenta Sueldos recibe los traspasos y paga los
// sueldos el mismo día, y en el orden del importador (cargos primero) el saldo
// pasaba por −$3.130.314. El saldo al cierre de cada día es el mismo en
// cualquier orden.
function ordenCartola(
  a: { date: Date; amount: number; description: string },
  b: { date: Date; amount: number; description: string }
): number {
  const d = a.date.getTime() - b.date.getTime();
  if (d !== 0) return d;
  if (a.amount !== b.amount) return b.amount - a.amount;
  return a.description.localeCompare(b.description);
}

// RUT reducido a dígitos + DV, sin ceros adelante, para comparar. El banco lo
// trae como "0180239839" (cero de relleno + RUT + DV) y las facturas como
// "18023983-9". null si no alcanza a ser un RUT.
export function rutComparable(rut: string | null | undefined): string | null {
  if (!rut) return null;
  const limpio = rut.toUpperCase().replace(/[^0-9K]/g, "").replace(/^0+/, "");
  return limpio.length >= 7 ? limpio : null;
}

// "180239839" → "18.023.983-9".
export function formatRut(rut: string | null | undefined): string | null {
  const r = rutComparable(rut);
  if (!r) return null;
  const cuerpo = r.slice(0, -1);
  const dv = r.slice(-1);
  return `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${dv}`;
}

// RUT de la contraparte de un movimiento. El importador lo guarda en las
// transferencias que salen, pero en las que ENTRAN ("0180239839 Transf. Maria
// Blanco Ro") suele quedar null: ahí se lee de los dígitos con que arranca la
// glosa — el mismo patrón que usa la deduplicación (banco/dedup.ts).
// También lo usan las rendiciones de los socios (rendiciones.ts).
export function rutDeMovimiento(m: { counterpartyRut: string | null; description: string }): string | null {
  const guardado = rutComparable(m.counterpartyRut);
  if (guardado) return guardado;
  const lider = m.description.match(/^(\d{8,11}[K\d])\s+Transf/i)?.[1];
  return rutComparable(lider);
}

function rutDeContraparte(m: MovimientoCartolaInput): string | null {
  return rutDeMovimiento(m);
}

// Nombre de la contraparte tal como lo trae la glosa, sin el RUT ni el "Transf a".
function nombreDeGlosa(m: MovimientoCartolaInput): string | null {
  if (m.counterpartyName?.trim()) return m.counterpartyName.trim();
  const sinRut = m.description.replace(/^\d{8,11}[K\d]\s+/i, "");
  const nombre = sinRut.replace(/^Transf(\.|erencia)?\s*(a|de)?\s*/i, "").trim();
  return /^Transf/i.test(sinRut) && nombre ? nombre : null;
}

function fechaCorta(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
}

// "2026-06" → "junio" (o "junio 2025" si no es el año del informe).
function nombrePeriodo(ym: string, yearInforme: number): string {
  const [y, m] = ym.split("-").map(Number);
  const mes = MESES[m - 1] ?? ym;
  return y === yearInforme ? mes : `${mes} ${y}`;
}

function esSinRespaldo(d: Pick<DocumentoCartola, "origin">): boolean {
  return d.origin === "sin_respaldo" || d.origin === "maxxa_sin_respaldo";
}

export function etiquetaDocumento(d: Pick<DocumentoCartola, "tipoDoc" | "origin">): string {
  if (d.tipoDoc === 1043) {
    if (d.origin === "gasto_boleta") return "Boleta";
    if (d.origin === "gasto_internacional") return "Gasto internacional";
    if (esSinRespaldo(d)) return "Pago sin respaldo";
    return "Sin documento";
  }
  switch (d.tipoDoc) {
    case 33: return "Factura";
    case 34: return "Factura exenta";
    case 39: return "Boleta";
    case 41: return "Boleta exenta";
    case 56: return "Nota de débito";
    case 61: return "Nota de crédito";
    case 1039: return "Boleta de honorarios";
    default: return "Documento";
  }
}

// La contraparte del DOCUMENTO: quien emite si es una compra, el cliente si es
// una venta.
function rutParteDocumento(d: DocumentoCartola): string | null {
  return d.type === "emitida" ? d.rutReceiver : d.rutIssuer;
}

function aplicacionDe(d: DocumentoCartola, monto: number): Aplicacion {
  return {
    documentoId: d.id,
    documento: etiquetaDocumento(d),
    // El folio SR- del pago sin respaldo lo inventa la app para colgar el pago:
    // no existe para el contador (mismo criterio que la tabla del banco).
    folio: esSinRespaldo(d) ? null : d.folioNumber,
    rut: formatRut(rutParteDocumento(d)),
    razonSocial: d.businessName,
    aplicado: monto,
  };
}

// ─── La frase de cada movimiento ────────────────────────────────────────────

type Explicacion = {
  queEs: string;
  detalle: string | null;
  // Movimiento marcado, pero con algo que no calza: se muestra PENDIENTE y no
  // se resuelve acá (lo aclara MJ).
  porAclarar: boolean;
};

type Contexto = {
  year: number;
  docs: Map<string, DocumentoCartola>;
  movPorId: Map<string, MovimientoReferido>;
  aliasCuenta: Map<string, string>;
  grupoNetoCero: Map<string, string[]>; // groupId → ids
  empleados: Map<string, string>; // rut comparable → nombre
};

function nombrePersona(m: MovimientoCartolaInput, ctx: Contexto): string {
  const rut = rutDeContraparte(m);
  if (rut && ctx.empleados.has(rut)) return ctx.empleados.get(rut)!;
  if (esSocio(rut, m.counterpartyName, m.description)) {
    return nombreSocio(rut, m.counterpartyName);
  }
  return nombreDeGlosa(m) ?? (rut ? `RUT ${formatRut(rut)}` : "sin nombre en la glosa");
}

function contraparteEsSocio(m: MovimientoCartolaInput): boolean {
  return esSocio(rutDeContraparte(m), m.counterpartyName, m.description);
}

function describirOtro(id: string, ctx: Contexto): string {
  const o = ctx.movPorId.get(id);
  if (!o) return "otro movimiento";
  const signo = o.amount < 0 ? "−" : "+";
  return `${fechaCorta(o.date)} ${signo}${formatCLP(Math.abs(o.amount))} (${ctx.aliasCuenta.get(o.cuentaId) ?? "otra cuenta"})`;
}

function explicarConDocumentos(m: MovimientoCartolaInput, ctx: Contexto, apps: Aplicacion[]): Explicacion {
  const docs = apps.map((a) => ctx.docs.get(a.documentoId)!).filter(Boolean);
  const rutMov = rutDeContraparte(m);
  const algunoEsDeLaContraparte =
    rutMov != null && docs.some((d) => rutComparable(rutParteDocumento(d)) === rutMov);
  const otraPersona = rutMov != null && !algunoEsDeLaContraparte;
  const todos = (f: (d: DocumentoCartola) => boolean) => docs.length > 0 && docs.every(f);

  if (m.amount > 0) {
    if (m.pagos.length === 0 && m.ncDevueltas.length > 0) {
      return { queEs: "Devolución de proveedor", detalle: "Nota de crédito que el proveedor devolvió a la cuenta", porAclarar: false };
    }
    if (todos((d) => d.type === "emitida")) {
      // El que transfiere no siempre es el cliente de la factura (paga el
      // dueño, la mamá, otra empresa del grupo): se dice, para que el
      // contador no lo busque por RUT.
      const detalle = otraPersona
        ? `Transfirió ${nombreDeGlosa(m) ?? `el RUT ${formatRut(rutMov)}`}, a nombre del cliente`
        : null;
      return { queEs: "Pago de cliente", detalle, porAclarar: false };
    }
    return { queEs: "Devolución de proveedor", detalle: null, porAclarar: false };
  }

  if (todos((d) => d.type === "emitida")) {
    return { queEs: "Devolución a cliente", detalle: null, porAclarar: false };
  }
  if (todos(esSinRespaldo)) {
    return {
      queEs: "Pago sin respaldo",
      detalle: `Pago a ${nombrePersona(m, ctx)} sin boleta ni factura`,
      porAclarar: false,
    };
  }
  // Transferencia a un SOCIO conciliada a facturas de otro: el socio pagó con
  // su plata y BLARQ se la devuelve. Tiene que decir "reembolso" — si no, el
  // contador cree que es plata para el socio.
  if (otraPersona && contraparteEsSocio(m)) {
    return {
      queEs: `Reembolso a ${nombrePersona(m, ctx)}`,
      detalle: "Pagó estas compras con su plata; BLARQ se la devuelve",
      porAclarar: false,
    };
  }
  if (otraPersona && todos((d) => d.origin === "gasto_boleta")) {
    return {
      queEs: `Reembolso a ${nombrePersona(m, ctx)}`,
      detalle: "Compró con su plata; BLARQ se la devuelve",
      porAclarar: false,
    };
  }
  if (todos((d) => d.tipoDoc === 1039)) {
    return {
      queEs: "Pago de honorarios",
      detalle: "Se paga el líquido de la boleta; la retención la entera BLARQ en el F29",
      porAclarar: false,
    };
  }
  if (todos((d) => d.origin === "gasto_internacional")) {
    return { queEs: "Gasto internacional", detalle: null, porAclarar: false };
  }
  return {
    queEs: "Pago a proveedor",
    detalle: otraPersona ? `Transferido a ${nombrePersona(m, ctx)} (RUT ${formatRut(rutMov)})` : null,
    porAclarar: false,
  };
}

function explicarSinDocumento(m: MovimientoCartolaInput, ctx: Contexto): Explicacion {
  const cat = m.category;
  const entra = m.amount > 0;
  const rut = rutDeContraparte(m);

  if (cat === "sueldo") {
    const periodo = nombrePeriodo(effectiveSalaryPeriod(m), ctx.year);
    const nombre = nombrePersona(m, ctx);
    // Sueldo a alguien que no tiene liquidación: no lo resolvemos acá, se
    // muestra pendiente para que MJ lo aclare (caso real: Juan Pablo, jul-2026).
    if (rut && !ctx.empleados.has(rut)) {
      return {
        queEs: "Por aclarar",
        detalle: `Marcado como sueldo de ${periodo}, pero ${nombre} no está en la planilla de remuneraciones`,
        porAclarar: true,
      };
    }
    return { queEs: `Sueldo de ${periodo}`, detalle: nombre, porAclarar: false };
  }

  if (cat === "previred") {
    const periodo = nombrePeriodo(effectiveSalaryPeriod(m), ctx.year);
    return { queEs: `Previred de ${periodo}`, detalle: "Cotizaciones de los sueldos de ese mes", porAclarar: false };
  }

  if (cat === "impuestos") {
    if (entra) return { queEs: "Devolución de impuestos", detalle: null, porAclarar: false };
    // El F29 se paga el mes siguiente al que declara (el SII del 17-jul es el
    // F29 de junio). Si MJ marcó el mes a mano, manda eso.
    const periodo = nombrePeriodo(m.salaryPeriod ?? shiftYearMonth(toYearMonth(m.date), -1), ctx.year);
    const esSII = /S\.?I\.?I\.?/i.test(m.description);
    return {
      queEs: esSII ? `Impuestos SII · F29 de ${periodo}` : "Impuestos",
      detalle: null,
      porAclarar: false,
    };
  }

  // Cuenta con los socios: retiro, préstamo, bono. Si la contraparte no es
  // socio (caso real: Rojas Mella, jun-2026), queda pendiente para MJ.
  if (cat === "retiro_personal" || cat === "prestamo_socio" || cat === "bono_socio") {
    const nombre = nombrePersona(m, ctx);
    const rotulo =
      cat === "retiro_personal" ? "retiro de socio" : cat === "bono_socio" ? "bono a socio" : "préstamo de socio";
    if (!contraparteEsSocio(m)) {
      return {
        queEs: "Por aclarar",
        detalle: `Marcado como ${rotulo}, pero ${nombre} no es socio`,
        porAclarar: true,
      };
    }
    if (cat === "retiro_personal") return { queEs: "Retiro de socio", detalle: nombre, porAclarar: false };
    if (cat === "bono_socio") return { queEs: "Bono a socio", detalle: nombre, porAclarar: false };
    // Préstamos y devoluciones van a la misma cuenta corriente: el sentido lo
    // da el signo, no hace falta distinguirlos (ver banco/socios.ts).
    return {
      queEs: "Préstamo de socio",
      detalle: entra ? `Entra de ${nombre} (cuenta corriente con los socios)` : `Sale a ${nombre} (cuenta corriente con los socios)`,
      porAclarar: false,
    };
  }

  if (cat === "comision_bancaria") return { queEs: "Comisión del banco", detalle: null, porAclarar: false };
  if (cat === "deposito_efectivo") return { queEs: "Depósito en efectivo", detalle: null, porAclarar: false };
  if (cat === "reembolso_proveedor") return { queEs: "Devolución de proveedor", detalle: null, porAclarar: false };
  if (cat === "otro_sin_factura") {
    return { queEs: entra ? "Otro ingreso sin factura" : "Otro gasto sin factura", detalle: null, porAclarar: false };
  }
  return { queEs: "Sin factura", detalle: categoriaBanco(cat)?.label ?? null, porAclarar: false };
}

function explicar(m: MovimientoCartolaInput, ctx: Contexto, apps: Aplicacion[], sinExplicar: number): Explicacion {
  if (m.status === MOV_STATUS.SIN_ASIGNAR) {
    return { queEs: "Sin explicar todavía", detalle: null, porAclarar: false };
  }

  if (m.status === MOV_STATUS.INTERNO || m.category === "transfer_interno") {
    const par = m.parInternoId ? ctx.movPorId.get(m.parInternoId) : null;
    const otraCuenta = par ? ctx.aliasCuenta.get(par.cuentaId) ?? "otra cuenta" : null;
    const partes: string[] = [];
    partes.push(
      otraCuenta
        ? m.amount < 0 ? `A la cuenta ${otraCuenta}` : `Desde la cuenta ${otraCuenta}`
        : "Sin el otro lado del traspaso"
    );
    if (m.projectName) {
      const de = m.internalConcepto === "muebles" ? "muebles" : "obra";
      partes.push(`utilidad de ${de} ${m.projectName}`);
    }
    return { queEs: "Traspaso entre cuentas BLARQ", detalle: partes.join(" · "), porAclarar: false };
  }

  if (m.status === MOV_STATUS.NETO_CERO && apps.length === 0) {
    const otros = (m.netZeroGroupId ? ctx.grupoNetoCero.get(m.netZeroGroupId) ?? [] : []).filter((id) => id !== m.id);
    // Si el otro lado es un pago que quedó conciliado a su factura y solo se
    // neteó lo que sobró, esto es la devolución de ese sobrante (Da Ingeniería:
    // pagó $2.153.598 por una factura de $2.105.607 y devolvió $47.991).
    const pagoConSobrante = otros
      .map((id) => ctx.movPorId.get(id))
      .find((o) => o && (o.netZeroAmount ?? 0) > 0 && (o.netZeroAmount ?? 0) < Math.abs(o.amount) - TOLERANCIA);
    if (pagoConSobrante) {
      return {
        queEs: "Devolución de un sobrante",
        detalle: `Lo que sobró del pago del ${describirOtro(pagoConSobrante.id, ctx)}; neto cero`,
        porAclarar: false,
      };
    }
    return {
      queEs: "Devolución (neto cero)",
      detalle: otros.length ? `Se cancela con ${otros.map((id) => describirOtro(id, ctx)).join(", ")}` : null,
      porAclarar: false,
    };
  }

  let base: Explicacion;
  if (apps.length > 0) base = explicarConDocumentos(m, ctx, apps);
  else base = explicarSinDocumento(m, ctx);

  const extras: string[] = [];
  if (base.detalle) extras.push(base.detalle);
  // Sobrante de un pago que el proveedor devolvió: la factura está bien pagada
  // y lo que sobró vuelve en otro movimiento (neto cero sobre el excedente).
  if ((m.netZeroAmount ?? 0) > 0 && apps.length > 0) {
    const otros = (m.netZeroGroupId ? ctx.grupoNetoCero.get(m.netZeroGroupId) ?? [] : []).filter((id) => id !== m.id);
    const fechas = otros.map((id) => ctx.movPorId.get(id)).filter(Boolean).map((o) => fechaCorta(o!.date));
    const cuando = fechas.length ? ` el ${fechas.join(", ")}` : "";
    extras.push(
      m.amount < 0
        ? `Sobrante de ${formatCLP(m.netZeroAmount!)} devuelto por el proveedor${cuando}`
        : `Devolución de un sobrante de ${formatCLP(m.netZeroAmount!)}${cuando}`
    );
  }
  if (sinExplicar > TOLERANCIA && m.status === MOV_STATUS.PARCIAL) {
    extras.push(`Falta explicar ${formatCLP(sinExplicar)}`);
  }
  return { ...base, detalle: extras.length ? extras.join(" · ") : null };
}

// ─── El armado ──────────────────────────────────────────────────────────────

export function armarCartola(datos: DatosCartola): CartolaConciliada {
  const aliasCuenta = new Map(datos.cuentas.map((c) => [c.id, c.alias]));
  const docs = new Map(datos.documentos.map((d) => [d.id, d]));
  const movPorId = new Map<string, MovimientoReferido>();
  for (const r of datos.referidos) movPorId.set(r.id, r);
  for (const m of datos.movimientos) {
    movPorId.set(m.id, {
      id: m.id,
      cuentaId: m.cuentaId,
      date: m.date,
      amount: m.amount,
      description: m.description,
      netZeroGroupId: m.netZeroGroupId,
      netZeroAmount: m.netZeroAmount,
    });
  }
  const grupoNetoCero = new Map<string, string[]>();
  for (const [id, m] of movPorId) {
    if (!m.netZeroGroupId) continue;
    const g = grupoNetoCero.get(m.netZeroGroupId) ?? [];
    g.push(id);
    grupoNetoCero.set(m.netZeroGroupId, g);
  }
  for (const ids of grupoNetoCero.values()) {
    ids.sort((a, b) => ordenCanonico(movPorId.get(a)!, movPorId.get(b)!));
  }
  const empleados = new Map<string, string>();
  for (const e of datos.empleados) {
    const r = rutComparable(e.rut);
    if (r) empleados.set(r, e.nombre);
  }
  const ctx: Contexto = { year: datos.year, docs, movPorId, aliasCuenta, grupoNetoCero, empleados };

  const filas: FilaCartola[] = [];
  const cuadratura: CuadraturaCuenta[] = [];
  const cuadraturaPorMes: CuadraturaMes[] = [];
  const nPorMovimiento = new Map<string, number>();
  let n = 0;

  for (const cuenta of datos.cuentas) {
    // Los saldos del banco se leen en el orden canónico del importador (es el
    // que usó para calcular balanceAfter); las filas van en el de la cartola.
    const canonicos = datos.movimientos.filter((m) => m.cuentaId === cuenta.id).sort(ordenCanonico);
    const movs = [...canonicos].sort(ordenCartola);
    // Sin movimientos anteriores al período: se deduce del cierre del primer
    // día, restándole lo que se movió ese día.
    const primerDia = canonicos.filter((m) => m.date.getTime() === canonicos[0]?.date.getTime());
    const cierrePrimerDia = saldoAlCierre(primerDia);
    const saldoInicial =
      cuenta.saldoInicialBanco ??
      (cierrePrimerDia != null ? cierrePrimerDia - primerDia.reduce((s, m) => s + m.amount, 0) : 0);
    let saldo = saldoInicial;

    for (const m of movs) {
      n += 1;
      nPorMovimiento.set(m.id, n);
      saldo += m.amount;

      const apps: Aplicacion[] = [
        ...m.pagos.flatMap((p) => {
          const d = docs.get(p.invoiceId);
          return d ? [aplicacionDe(d, p.amountApplied)] : [];
        }),
        ...m.ncDevueltas.flatMap((nc) => {
          const d = docs.get(nc.invoiceId);
          return d ? [aplicacionDe(d, nc.monto)] : [];
        }),
      ].sort((a, b) => b.aplicado - a.aplicado);

      // Lo explicado: facturas + NC devueltas + sobrante neteado (las tres vías
      // de saldadoDelMovimiento en movementStatus.ts).
      const explicado =
        m.pagos.reduce((s, p) => s + p.amountApplied, 0) +
        m.ncDevueltas.reduce((s, x) => s + x.monto, 0) +
        (m.netZeroAmount ?? 0);
      const libre = Math.max(0, Math.abs(m.amount) - explicado);

      const exp = explicar(m, ctx, apps, libre);
      const estado: EstadoCartola = exp.porAclarar
        ? "Pendiente"
        : (deriveEstado(m.status).label as EstadoCartola);
      const sinExplicar =
        estado === "Pendiente" ? Math.abs(m.amount) : estado === "Parcial" ? libre : 0;

      filas.push({
        n,
        movimientoId: m.id,
        fecha: m.date,
        cuenta: cuenta.alias,
        descripcion: m.description,
        cargo: m.amount < 0 ? -m.amount : null,
        abono: m.amount > 0 ? m.amount : null,
        saldo,
        estado,
        queEs: exp.queEs,
        detalle: exp.detalle,
        aplicaciones: apps,
        sinExplicar,
      });
    }

    const saldoFinalBanco = saldoAlCierre(delUltimoDia(canonicos)) ?? saldoInicial;
    cuadratura.push(cuadrar(cuenta, saldoInicial, canonicos, saldoFinalBanco));

    // Año completo: la misma cuadratura mes a mes. El saldo inicial de cada
    // mes es el saldo de la cartola al cierre del mes anterior.
    if (datos.month == null) {
      let inicioMes = saldoInicial;
      for (let mes = 1; mes <= 12; mes++) {
        const delMes = canonicos.filter((m) => m.date.getUTCMonth() + 1 === mes);
        if (delMes.length === 0) continue;
        const finMes = saldoAlCierre(delUltimoDia(delMes)) ?? inicioMes + delMes.reduce((s, m) => s + m.amount, 0);
        cuadraturaPorMes.push({ ...cuadrar(cuenta, inicioMes, delMes, finMes), month: mes });
        inicioMes = finMes;
      }
    }
  }

  const fechas = datos.movimientos.map((m) => m.date.getTime());
  return {
    year: datos.year,
    month: datos.month,
    periodo: datos.month == null ? `año ${datos.year}` : `${MESES[datos.month - 1]} ${datos.year}`,
    esAño: datos.month == null,
    desde: fechas.length ? new Date(Math.min(...fechas)) : null,
    hasta: fechas.length ? new Date(Math.max(...fechas)) : null,
    filas,
    cuadratura,
    cuadraturaPorMes,
    facturasPartidas: armarFacturasPartidas(datos, ctx, nPorMovimiento),
    resumen: {
      movimientos: filas.length,
      conciliados: filas.filter((f) => f.estado === "Conciliado").length,
      parciales: filas.filter((f) => f.estado === "Parcial").length,
      pendientes: filas.filter((f) => f.estado === "Pendiente").length,
    },
  };
}

// Saldo inicial + abonos − cargos, contra el saldo final de la cartola.
function cuadrar(
  cuenta: CuentaCartolaInput,
  saldoInicial: number,
  movs: { amount: number }[],
  saldoFinalBanco: number
): CuadraturaCuenta {
  const entradas = movs.filter((m) => m.amount > 0).reduce((s, m) => s + m.amount, 0);
  const salidas = movs.filter((m) => m.amount < 0).reduce((s, m) => s - m.amount, 0);
  const saldoCalculado = saldoInicial + entradas - salidas;
  return {
    cuenta: cuenta.alias,
    numero: cuenta.accountNumber,
    saldoInicial,
    entradas,
    salidas,
    saldoCalculado,
    saldoFinalBanco,
    diferencia: saldoFinalBanco - saldoCalculado,
    movimientos: movs.length,
  };
}

// Hoja "por factura": cada documento pagado en el período que se pagó EN PARTES
// (más de una transferencia, saldo pendiente o nota de crédito encima), con
// TODAS las transferencias que lo pagaron —también las de fuera del período— y
// cuánto le queda. Los pagos 1 a 1 no entran: esos el contador ya los concilia
// solo por monto exacto.
function armarFacturasPartidas(
  datos: DatosCartola,
  ctx: Contexto,
  nPorMovimiento: Map<string, number>
): FacturaPartida[] {
  const delPeriodo = new Set<string>();
  for (const m of datos.movimientos) for (const p of m.pagos) delPeriodo.add(p.invoiceId);

  const out: FacturaPartida[] = [];
  for (const id of delPeriodo) {
    const d = ctx.docs.get(id);
    if (!d) continue;
    const pagosRaw = datos.pagosDeDocumentos
      .filter((p) => p.invoiceId === id)
      .map((p) => ({ p, mov: ctx.movPorId.get(p.bankMovementId) }))
      .filter((x) => x.mov)
      // Por fecha; dentro del día, en el orden en que aparecen en la cartola.
      .sort(
        (a, b) =>
          a.mov!.date.getTime() - b.mov!.date.getTime() ||
          (nPorMovimiento.get(a.p.bankMovementId) ?? 0) - (nPorMovimiento.get(b.p.bankMovementId) ?? 0) ||
          ordenCanonico(a.mov!, b.mov!)
      );
    const ncs = datos.ncAplicadas.filter((x) => x.invoiceId === id);

    const total = d.totalAmount;
    const pagado = pagosRaw.reduce((s, x) => s + x.p.amountApplied, 0);
    // Mismo tope que recomputeInvoiceStatus: una NC no deja la factura pagada
    // "de más".
    const ncPedido = ncs.reduce((s, x) => s + x.monto, 0);
    const ncCuenta = Math.max(0, Math.min(ncPedido, total - pagado));
    // Boleta de honorarios: lo que no se le pagó a la persona es la retención,
    // que BLARQ entera en el F29 (misma tasa que usa el F29 de la app). Con
    // tope, igual que la NC: si se pagó el bruto entero no hay retención que
    // mostrar.
    const tasa = d.tipoDoc === 1039 ? tasaRetencionHonorarios(d.issueDate.getUTCFullYear()) : null;
    const retencion =
      d.tipoDoc === 1039
        ? Math.max(0, Math.min(retencionHonorario(total, d.issueDate.getUTCFullYear()), total - pagado - ncCuenta))
        : 0;
    const leQueda = total - pagado - ncCuenta - retencion;

    const partida = pagosRaw.length >= 2 || Math.abs(leQueda) > TOLERANCIA || ncs.length > 0;
    if (!partida) continue;

    // "Le queda" después de cada pago parte del total menos la retención: esa
    // parte nunca se le transfiere a quien emitió la boleta.
    let acumulado = retencion;
    const pagos: PagoDeFactura[] = pagosRaw.map(({ p, mov }) => {
      acumulado += p.amountApplied;
      return {
        fecha: mov!.date,
        cuenta: ctx.aliasCuenta.get(mov!.cuentaId) ?? "",
        n: nPorMovimiento.get(p.bankMovementId) ?? null,
        descripcion: mov!.description,
        montoTransferencia: mov!.amount,
        aplicado: p.amountApplied,
        leQueda: total - acumulado,
      };
    });

    const app = aplicacionDe(d, 0);
    out.push({
      documentoId: id,
      documento: app.documento,
      folio: app.folio,
      rut: app.rut,
      razonSocial: app.razonSocial,
      lado: d.type === "emitida" ? "venta" : "compra",
      fechaEmision: d.issueDate,
      total,
      anulada: d.status === "anulada",
      pagos,
      notasCredito: ncs.map((x) => ({ folio: x.folio, monto: x.monto })),
      retencion,
      retencionTasa: retencion > 0 ? tasa : null,
      leQueda,
    });
  }

  // Ventas primero (lo que el contador más pregunta: "¿con qué pagó el
  // cliente?"), después compras; dentro de cada lado, por folio.
  return out.sort((a, b) => {
    if (a.lado !== b.lado) return a.lado === "venta" ? -1 : 1;
    const fa = Number(a.folio) || 0;
    const fb = Number(b.folio) || 0;
    return fa - fb || (a.razonSocial ?? "").localeCompare(b.razonSocial ?? "");
  });
}
