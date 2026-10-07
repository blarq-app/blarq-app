// Rendiciones de gastos de los socios, para el contador.
//
// El contador las pidió (MJ, 2026-10-07): "un documento que muestre lo que yo
// le muestro a BLARQ en qué gasté, y lo mismo JT, conciliado con sus facturas".
// Son las compras de BLARQ que MJ o JT pagaron con su plata (su tarjeta, su
// cuenta) y que BLARQ les devolvió con una transferencia. En la app eso ya
// existe: la transferencia de BLARQ al socio está conciliada a las facturas
// del proveedor (ver la skill reembolso-tarjeta y el "Reembolso a …" de la
// cartola conciliada). Este módulo lo junta por socio.
//
// Decidido con MJ (2026-10-07):
//   - Ordenado POR REEMBOLSO: cada transferencia de BLARQ al socio y, debajo,
//     las facturas que cubre, con obra y categoría. Si a un reembolso le falta
//     respaldo, se dice cuánto y se muestra la nota que dejó MJ (ej. el del
//     06-oct-2026: "Falta factura · Comercial K…").
//   - La obra "CASA" es gasto de BLARQ: va como cualquier otra.
//
// Qué es un reembolso acá: una salida de plata hacia un socio (por RUT, igual
// que la cartola) conciliada a documentos RECIBIDOS de otro emisor. Las
// transferencias a un socio sin facturas (sueldo, retiro, préstamo) no son
// rendición. Tampoco un pago a una boleta de honorarios del mismo socio: esa
// es su boleta, no una compra que rinde.
//
// Puro (sin base): lo arma rendicionesDatos.ts. SOLO LEE; no calcula plata
// propia: lo rendido es lo que MJ concilió (InvoicePayment.amountApplied).

import { esSocio, SOCIOS } from "@/lib/banco/socios";
import {
  MESES,
  etiquetaDocumento,
  formatRut,
  rutComparable,
  rutDeMovimiento,
} from "@/lib/contabilidad/cartolaConciliada";

export type DocumentoRendicion = {
  id: string;
  type: string;
  tipoDoc: number | null;
  folioNumber: string | null;
  rutIssuer: string | null;
  businessName: string | null;
  totalAmount: number;
  origin: string | null;
  issueDate: Date;
  obra: string | null;
  categoria: string | null;
};

export type MovimientoRendicionInput = {
  id: string;
  date: Date;
  cuenta: string;
  description: string;
  amount: number; // con signo; los reembolsos son salidas
  counterpartyRut: string | null;
  counterpartyName: string | null;
  notes: string | null;
  netZeroAmount: number | null;
  pagos: { invoiceId: string; amountApplied: number }[];
};

export type DatosRendiciones = {
  year: number;
  month: number | null; // null = año completo
  movimientos: MovimientoRendicionInput[];
  documentos: DocumentoRendicion[];
  // Nombres completos de la planilla (Empleado); si un socio no está, se usa
  // el nombre corto de banco/socios.ts.
  empleados: { rut: string; nombre: string }[];
};

export type LineaRendicion = {
  documentoId: string;
  fechaDocumento: Date;
  documento: string;
  folio: string | null;
  rut: string | null;
  proveedor: string | null;
  obra: string | null;
  categoria: string | null;
  totalDocumento: number;
  rendido: number; // lo que este reembolso pagó de ese documento
};

export type Reembolso = {
  movimientoId: string;
  fecha: Date;
  cuenta: string;
  descripcion: string;
  monto: number; // positivo
  lineas: LineaRendicion[];
  respaldado: number;
  sinRespaldo: number; // 0 = todo el reembolso tiene documento
  nota: string | null; // solo cuando falta respaldo
};

export type RendicionSocio = {
  socio: string;
  rut: string | null;
  reembolsos: Reembolso[];
  total: number;
  respaldado: number;
  sinRespaldo: number;
  documentos: number;
};

export type Rendiciones = {
  year: number;
  month: number | null;
  periodo: string; // "julio 2026" o "año 2026"
  esAño: boolean;
  socios: RendicionSocio[];
};

const TOLERANCIA = 1;

function rutDeSocio(rut: string): string | null {
  return SOCIOS.find((s) => rut.includes(s.rut))?.rut ?? null;
}

export function armarRendiciones(datos: DatosRendiciones): Rendiciones {
  const docs = new Map(datos.documentos.map((d) => [d.id, d]));
  const nombres = new Map<string, string>();
  for (const e of datos.empleados) {
    const r = rutComparable(e.rut);
    const socio = r ? rutDeSocio(r) : null;
    if (socio) nombres.set(socio, e.nombre);
  }

  const porSocio = new Map<string, Reembolso[]>();
  for (const s of SOCIOS) porSocio.set(s.rut, []);

  const movs = [...datos.movimientos].sort(
    (a, b) => a.date.getTime() - b.date.getTime() || a.amount - b.amount
  );
  for (const m of movs) {
    if (m.amount >= 0) continue;
    const rut = rutDeMovimiento(m);
    if (!rut || !esSocio(rut, m.counterpartyName, m.description)) continue;
    const socio = rutDeSocio(rut);
    if (!socio) continue;

    const lineas: LineaRendicion[] = [];
    for (const p of m.pagos) {
      const d = docs.get(p.invoiceId);
      if (!d || d.type !== "recibida") continue;
      // Su propia boleta de honorarios no es una compra que rinde.
      if (rutComparable(d.rutIssuer) === rut) continue;
      lineas.push({
        documentoId: d.id,
        fechaDocumento: d.issueDate,
        documento: etiquetaDocumento(d),
        folio: d.origin === "sin_respaldo" || d.origin === "maxxa_sin_respaldo" ? null : d.folioNumber,
        rut: formatRut(d.rutIssuer),
        proveedor: d.businessName,
        obra: d.obra,
        categoria: d.categoria,
        totalDocumento: d.totalAmount,
        rendido: p.amountApplied,
      });
    }
    if (lineas.length === 0) continue;
    lineas.sort(
      (a, b) =>
        a.fechaDocumento.getTime() - b.fechaDocumento.getTime() ||
        (a.proveedor ?? "").localeCompare(b.proveedor ?? "")
    );

    const monto = -m.amount;
    const respaldado = lineas.reduce((s, l) => s + l.rendido, 0);
    // Lo que del reembolso no tiene documento: el monto menos todo lo
    // conciliado (y el sobrante neteado, si el proveedor devolvió algo).
    const explicado = m.pagos.reduce((s, p) => s + p.amountApplied, 0) + (m.netZeroAmount ?? 0);
    const libre = monto - explicado;
    const sinRespaldo = libre > TOLERANCIA ? libre : 0;

    porSocio.get(socio)!.push({
      movimientoId: m.id,
      fecha: m.date,
      cuenta: m.cuenta,
      descripcion: m.description,
      monto,
      lineas,
      respaldado,
      sinRespaldo,
      nota: sinRespaldo > 0 && m.notes?.trim() ? m.notes.trim() : null,
    });
  }

  const socios: RendicionSocio[] = SOCIOS.map((s) => {
    const reembolsos = porSocio.get(s.rut) ?? [];
    const rutCompleto = datos.empleados.find((e) => rutComparable(e.rut)?.startsWith(s.rut))?.rut ?? null;
    return {
      socio: nombres.get(s.rut) ?? s.nombre,
      rut: formatRut(rutCompleto),
      reembolsos,
      total: reembolsos.reduce((x, r) => x + r.monto, 0),
      respaldado: reembolsos.reduce((x, r) => x + r.respaldado, 0),
      sinRespaldo: reembolsos.reduce((x, r) => x + r.sinRespaldo, 0),
      documentos: reembolsos.reduce((x, r) => x + r.lineas.length, 0),
    };
  })
    // Primero quien más rindió en el período.
    .sort((a, b) => b.total - a.total || a.socio.localeCompare(b.socio));

  return {
    year: datos.year,
    month: datos.month,
    periodo: datos.month == null ? `año ${datos.year}` : `${MESES[datos.month - 1]} ${datos.year}`,
    esAño: datos.month == null,
    socios,
  };
}
