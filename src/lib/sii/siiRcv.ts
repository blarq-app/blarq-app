// Cliente para el sistema "Consulta Registro de Compras y Ventas" del SII
// (consdcvinternetui). Usa el token obtenido vía siiAuth (flow SOAP de
// CrSeed + GetTokenFromSeed). Confirmado en producción: el token SOAP
// funciona como conversationId para estos endpoints REST.
//
// Endpoints descubiertos vía inspección del portal web del SII:
//
//   POST /consdcvinternetui/services/data/facadeService/getResumen
//     → resumen mensual por tipo de doc (33, 34, 39, 41, 56, 61)
//
//   POST /consdcvinternetui/services/data/facadeService/getDetalleCompra
//     → listado completo de DTEs recibidos del mes filtrado por tipo
//
// Ambos requieren:
//   - rutEmisor + dvEmisor del CONTRIBUYENTE consultante (BLARQ)
//   - ptributario formato YYYYMM
//   - estadoContab "REGISTRO" (puede ser otros estados)
//   - operacion "COMPRA" para recibidos, "VENTA" para emitidos
//
// El detalle adicionalmente requiere:
//   - codTipoDoc (string del nro tipoDoc: "33", "61", etc)
//   - busquedaInicial: true en el resumen
//   - accionRecaptcha + tokenRecaptcha (placeholders, no se valida server-side)

import { randomUUID } from "crypto";
import { getSiiToken } from "./siiAuth";

const SII_BASE = "https://www4.sii.cl";

export interface RcvResumenItem {
  dcvCodigo: number;
  rsmnCodigo: number;
  rsmnTipoDocInteger: number;
  dcvNombreTipoDoc: string;
  rsmnMntNeto: number;
  rsmnMntIVA: number;
  rsmnMntTotal: number;
  rsmnMntExe: number;
  rsmnTotDoc: number;
}

export interface RcvDetalleItem {
  dhdrCodigo: number;
  dcvCodigo: number;
  detCodigo: number;
  detRutDoc: number;
  detDvDoc: string;
  detRznSoc: string;
  detNroDoc: number;
  detFchDoc: string; // dd/mm/yyyy
  detFecRecepcion: string | null;
  detMntExe: number;
  detMntNeto: number;
  detMntIVA: number;
  detMntTotal: number;
}

interface RutDv {
  rut: number;
  dv: string;
}

/**
 * Pide al SII el resumen del Registro de Compras (o Ventas) del período.
 * Devuelve un item por tipo de documento.
 *
 * `periodo` debe ser formato YYYYMM (ej "202604" para abril 2026).
 * `operacion` "COMPRA" para recibidos, "VENTA" para emitidos.
 */
export async function getRcvResumen(
  contribuyente: RutDv,
  periodo: string,
  operacion: "COMPRA" | "VENTA" = "COMPRA"
): Promise<RcvResumenItem[]> {
  const token = await getSiiToken();
  const body = {
    metaData: {
      namespace: "cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getResumen",
      conversationId: token,
      transactionId: randomUUID(),
      page: null,
    },
    data: {
      rutEmisor: String(contribuyente.rut),
      dvEmisor: contribuyente.dv,
      ptributario: periodo,
      estadoContab: "REGISTRO",
      operacion,
      busquedaInicial: true,
    },
  };

  const res = await fetch(
    `${SII_BASE}/consdcvinternetui/services/data/facadeService/getResumen`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `TOKEN=${token}`,
        Accept: "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`SII getResumen falló: ${res.status} — ${txt.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: RcvResumenItem[] };
  return json.data ?? [];
}

/**
 * Pide al SII el listado completo de DTEs recibidos (o emitidos) del mes,
 * filtrado por tipo de documento.
 *
 * `codTipoDoc` ej "33" (factura electrónica), "61" (nota de crédito).
 */
export async function getRcvDetalle(
  contribuyente: RutDv,
  periodo: string,
  codTipoDoc: string,
  operacion: "COMPRA" | "VENTA" = "COMPRA"
): Promise<RcvDetalleItem[]> {
  const token = await getSiiToken();
  const body = {
    metaData: {
      namespace: "cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getDetalleCompra",
      conversationId: token,
      transactionId: randomUUID(),
      page: null,
    },
    data: {
      rutEmisor: String(contribuyente.rut),
      dvEmisor: contribuyente.dv,
      ptributario: periodo,
      codTipoDoc,
      operacion,
      estadoContab: "REGISTRO",
      // Placeholders — el server no los valida en este flow auth.
      accionRecaptcha: "RCV_DETC",
      tokenRecaptcha: "t-o-k-e-n-web",
    },
  };

  const res = await fetch(
    `${SII_BASE}/consdcvinternetui/services/data/facadeService/getDetalleCompra`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `TOKEN=${token}`,
        Accept: "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`SII getDetalleCompra falló: ${res.status} — ${txt.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: RcvDetalleItem[] };
  return json.data ?? [];
}
