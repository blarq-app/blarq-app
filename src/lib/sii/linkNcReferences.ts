// Auto-link de NCs recibidas a sus facturas referenciadas via SII.
//
// Para cada NC en BD sin referenceFolioNumber, consulta el SII directamente
// (getRcvDetalle + getDteReferencias) y setea los campos. Idempotente: si
// la NC ya tiene referencia, la skip.
//
// Se invoca después del sync SII para cubrir las NCs nuevas que llegaron.
// También se puede correr manualmente vía script para backfill.

import { prisma } from "@/lib/prisma";
import { getRcvDetalle, getDteReferencias } from "./siiRcv";

const BLARQ = { rut: 77270733, dv: "9" };

export interface LinkResult {
  total: number;
  linked: number;
  notFoundInRcv: number;
  noRefs: number;
  errors: number;
}

function periodOfDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeRut(rut: string): { rut: number; dv: string } {
  const clean = rut.replace(/[.\s]/g, "").toUpperCase();
  const m = clean.match(/^(\d+)-([\dK])$/);
  if (!m) throw new Error(`RUT inválido: ${rut}`);
  return { rut: parseInt(m[1], 10), dv: m[2] };
}

/**
 * Linkea las NCs recibidas que no tienen referenceFolioNumber. Solo procesa
 * las que están en los períodos pasados — si no se pasa ninguno, procesa todas.
 *
 * Cachea el RCV por período para no repetir llamadas.
 */
export async function linkNcReferences(opts?: {
  periodos?: string[]; // ["202604", "202605", ...]
  invoiceIds?: string[]; // limitar a estas invoices
}): Promise<LinkResult> {
  const where: {
    tipoDoc: number;
    type: string;
    referenceFolioNumber: null;
    id?: { in: string[] };
    issueDate?: { gte: Date; lt: Date };
  } = {
    tipoDoc: 61,
    type: "recibida",
    referenceFolioNumber: null,
  };
  if (opts?.invoiceIds) {
    where.id = { in: opts.invoiceIds };
  }

  const ncs = await prisma.invoice.findMany({
    where,
    select: {
      id: true,
      folioNumber: true,
      rutIssuer: true,
      issueDate: true,
    },
  });

  const result: LinkResult = {
    total: ncs.length,
    linked: 0,
    notFoundInRcv: 0,
    noRefs: 0,
    errors: 0,
  };
  if (ncs.length === 0) return result;

  // Filtrar por períodos si se piden
  const targetNcs = opts?.periodos
    ? ncs.filter((n) => opts.periodos!.includes(periodOfDate(n.issueDate)))
    : ncs;

  const rcvCache = new Map<string, Awaited<ReturnType<typeof getRcvDetalle>>>();

  for (const nc of targetNcs) {
    if (!nc.folioNumber || !nc.rutIssuer) continue;
    const periodo = periodOfDate(nc.issueDate);

    try {
      let rcv = rcvCache.get(periodo);
      if (!rcv) {
        rcv = await getRcvDetalle(BLARQ, periodo, "61", "COMPRA");
        rcvCache.set(periodo, rcv);
      }

      const issuerNorm = normalizeRut(nc.rutIssuer);
      const folioNum = parseInt(nc.folioNumber, 10);
      const rcvNc = rcv.find(
        (r) => r.detRutDoc === issuerNorm.rut && r.detNroDoc === folioNum
      );
      if (!rcvNc) {
        result.notFoundInRcv++;
        continue;
      }

      const det = await getDteReferencias(BLARQ, {
        rcvPcarga: parseInt(periodo, 10),
        rutDoc: rcvNc.detRutDoc,
        dvDoc: rcvNc.detDvDoc,
        dcvNroDoc: rcvNc.detNroDoc,
        codTipoDoc: "61",
        dhdrCodigo: rcvNc.dhdrCodigo,
        detCodigo: rcvNc.detCodigo,
      });

      if (det.dataReferencias.length === 0) {
        result.noRefs++;
        continue;
      }

      const ref = det.dataReferencias[0];
      await prisma.invoice.update({
        where: { id: nc.id },
        data: {
          referenceFolioNumber: String(ref.dhdrFolio),
          referenceTipoDoc: ref.dtdcCodigo,
        },
      });
      result.linked++;
    } catch {
      result.errors++;
    }
  }

  return result;
}
