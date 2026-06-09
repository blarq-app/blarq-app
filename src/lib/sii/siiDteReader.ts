// Lector de DTEs directo del SII — reemplaza a SimpleFactura para LEER.
//
// SimpleFactura nos cobraba por entregarnos el listado de facturas recibidas
// y emitidas. Esa misma información la entrega el SII gratis vía el Registro
// de Compras y Ventas (RCV), usando el certificado digital de BLARQ. Este
// módulo expone `fetchDTEsFromSII` con la MISMA firma que el `fetchDTEs` de
// SimpleFactura (devuelve `RemoteDTE[]`), así el resto de la app no se entera
// del cambio de fuente.
//
// Diferencia de modelo respecto a SimpleFactura:
//   - SimpleFactura aceptaba un rango libre de fechas (desde/hasta).
//   - El RCV del SII es POR PERÍODO MENSUAL (YYYYMM). Por eso este lector
//     expande el rango pedido a la lista de meses que abarca, consulta cada
//     mes, y al final filtra los DTEs por la fecha exacta [fromDate, toDate].
//
// Por cada mes:
//   1. getRcvResumen → qué tipos de doc tienen movimiento ese mes (evita
//      pedir detalle de tipos con 0 docs).
//   2. getRcvDetalle por cada tipo con docs → el listado con neto/IVA/total.
//
// Formato de RUT: el SII entrega `detRutDoc` (entero) + `detDvDoc` (dígito
// verificador). Los unimos como "12345678-9" — EXACTAMENTE el formato que ya
// usa la base (heredado de SimpleFactura), así el upsert por la unique key
// (type, tipoDoc, folioNumber, rutIssuer) sigue siendo idempotente y no
// duplica las facturas históricas.

import { getRcvResumen, getRcvDetalle, type RcvDetalleItem } from "./siiRcv";
import type { RemoteDTE, FetchOptions } from "./simpleFacturaClient";

/**
 * ¿Está el certificado digital configurado? Es el requisito para leer del SII
 * directo. Si no está (típico en dev sin cert), el sync cae a datos mock.
 */
export function isSiiReaderAvailable(): boolean {
  const hasPassword = !!process.env.SII_CERT_PASSWORD;
  const hasCert = !!(process.env.SII_CERT_PATH || process.env.SII_CERT_BASE64);
  return hasPassword && hasCert;
}

// RUT de BLARQ como contribuyente consultante. Configurable por si se opera
// otra empresa, con default a los valores conocidos.
function blarqContribuyente(): { rut: number; dv: string } {
  const rut = parseInt(process.env.SII_BLARQ_RUT ?? "77270733", 10);
  const dv = process.env.SII_BLARQ_DV ?? "9";
  return { rut, dv };
}

function blarqRutStr(): string {
  const { rut, dv } = blarqContribuyente();
  return `${rut}-${dv}`;
}

// Lista de períodos YYYYMM que cubre el rango [fromDate, toDate].
function periodsInRange(fromDate: string, toDate: string): string[] {
  const start = new Date(fromDate + "T00:00:00Z");
  const end = new Date(toDate + "T00:00:00Z");
  const periods: string[] = [];
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cur <= end) {
    periods.push(
      `${cur.getUTCFullYear()}${String(cur.getUTCMonth() + 1).padStart(2, "0")}`
    );
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return periods;
}

// El SII entrega fecha "dd/mm/yyyy". La pasamos a "yyyy-mm-dd".
// Null-safe: el Registro de Ventas trae documentos basura (ej. tipoDoc 48
// "comprobante de pago", sin RUT ni fecha) con detFchDoc=null. Antes esto
// reventaba TODA la sincronización de ventas (`null.match()`). Devolvemos ""
// para esos casos → el filtro de rango de fechas los descarta solo.
function parseSiiDate(s: string | null | undefined): string {
  if (!s) return "";
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return s.slice(0, 10);
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

// Mapea una fila del RCV a la forma normalizada RemoteDTE.
function toRemoteDTE(
  d: RcvDetalleItem,
  tipoDoc: number,
  type: "emitida" | "recibida"
): RemoteDTE {
  const counterpartyRut = `${d.detRutDoc}-${d.detDvDoc}`;
  // El neto de las exentas viene en detMntExe (no en detMntNeto). Lo sumamos
  // al neto para que el total = neto + iva cierre en facturas exentas (34/41).
  const neto = (d.detMntNeto ?? 0) + (d.detMntExe ?? 0);
  return {
    type,
    tipoDoc,
    folioNumber: String(d.detNroDoc),
    // Recibida: el emisor es la contraparte (proveedor), BLARQ recibe.
    // Emitida: BLARQ emite, la contraparte recibe.
    rutIssuer: type === "recibida" ? counterpartyRut : blarqRutStr(),
    rutReceiver: type === "recibida" ? blarqRutStr() : counterpartyRut,
    businessName: d.detRznSoc ?? "",
    issueDate: parseSiiDate(d.detFchDoc),
    netAmount: neto,
    iva: d.detMntIVA ?? 0,
    totalAmount: d.detMntTotal ?? 0,
  };
}

/**
 * Trae los DTEs del SII (recibidos o emitidos) para el rango pedido.
 * Drop-in replacement de `fetchDTEs` de simpleFacturaClient.
 */
export async function fetchDTEsFromSII(opts: FetchOptions): Promise<RemoteDTE[]> {
  const contribuyente = blarqContribuyente();
  const operacion = opts.type === "recibida" ? "COMPRA" : "VENTA";
  const toDate = opts.toDate ?? new Date().toISOString().slice(0, 10);
  const periods = periodsInRange(opts.fromDate, toDate);

  // El SII separa las compras en bandejas por estado contable. Las facturas
  // que un proveedor emite recién caen en "PENDIENTE" (plazo de acuse de
  // recibo, ~8 días) y solo después pasan a "REGISTRO". El sync histórico
  // leía solo REGISTRO, así que esas facturas nuevas no aparecían hasta que
  // venciera el plazo. Leemos ambas bandejas para traerlas apenas se emiten.
  // En ventas (DTEs emitidos por BLARQ) no existe la bandeja de pendientes —
  // todo está en REGISTRO — así que solo iteramos PENDIENTE para compras.
  // El upsert es idempotente (unique key folio+RUT): cuando una factura pasa
  // de PENDIENTE a REGISTRO, el sync la reconoce como la misma, no duplica.
  const estados: ("REGISTRO" | "PENDIENTE")[] =
    operacion === "COMPRA" ? ["REGISTRO", "PENDIENTE"] : ["REGISTRO"];

  const out: RemoteDTE[] = [];
  for (const periodo of periods) {
    for (const estado of estados) {
      // 1. Resumen del mes — qué tipos de doc tienen movimiento en esta bandeja.
      const resumen = await getRcvResumen(
        contribuyente,
        periodo,
        operacion,
        estado
      );
      const tiposConDocs = resumen
        .filter((r) => r.rsmnTotDoc > 0)
        .map((r) => r.rsmnTipoDocInteger);

      // 2. Detalle por cada tipo de doc con movimiento.
      for (const tipoDoc of tiposConDocs) {
        const detalle = await getRcvDetalle(
          contribuyente,
          periodo,
          String(tipoDoc),
          operacion,
          estado
        );
        for (const d of detalle) {
          // Saltar documentos basura sin fecha (ej. tipoDoc 48 "comprobante de
          // pago" sin RUT ni fecha que aparece en el Registro de Ventas).
          if (!d.detFchDoc) continue;
          out.push(toRemoteDTE(d, tipoDoc, opts.type));
        }
      }
    }
  }

  // Filtrar por la fecha exacta del rango — el RCV trae el mes completo y el
  // rango pedido puede empezar/terminar a mitad de mes.
  return out.filter(
    (dte) => dte.issueDate >= opts.fromDate && dte.issueDate <= toDate
  );
}
