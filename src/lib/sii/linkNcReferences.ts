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
      // Auto-aplicar la compensación lógica: si encuentro la factura
      // referenciada del MISMO proveedor (mismo type + mismo rutIssuer/
      // rutReceiver), la marco como objetivo de la NC y actualizo su
      // status (anulada cuando la NC la cubre completa).
      await autoApplyNcCompensation(nc.id).catch(() => undefined);
      result.linked++;
    } catch {
      result.errors++;
    }
  }

  return result;
}

/**
 * Dada una NC con referenceFolioNumber poblado, busca la factura
 * referenciada del mismo proveedor (recibida) o mismo cliente (emitida)
 * y aplica la compensación: setea appliedToInvoiceId + compensationType
 * + actualiza status de la factura objetivo (anulada cuando la NC la
 * cubre completa, parcial sino).
 *
 * Idempotente: si la NC ya tiene compensationType seteado o no encuentra
 * la factura objetivo, no hace nada.
 *
 * Exportada para que el backfill script la pueda invocar también.
 */
export async function autoApplyNcCompensation(ncId: string): Promise<boolean> {
  const nc = await prisma.invoice.findUnique({
    where: { id: ncId },
    select: {
      id: true, tipoDoc: true, type: true, totalAmount: true,
      rutIssuer: true, rutReceiver: true,
      referenceFolioNumber: true, compensationType: true,
    },
  });
  if (!nc || nc.tipoDoc !== 61) return false;
  if (!nc.referenceFolioNumber) return false;
  if (nc.compensationType) return false; // ya compensada

  // Buscar factura del mismo proveedor (o cliente, si la NC es emitida)
  // con folio = referenceFolioNumber, no NC.
  const sameRutFilter = nc.type === "recibida"
    ? { rutIssuer: nc.rutIssuer ?? undefined }
    : { rutReceiver: nc.rutReceiver ?? undefined };
  const target = await prisma.invoice.findFirst({
    where: {
      type: nc.type,
      folioNumber: nc.referenceFolioNumber,
      tipoDoc: { in: [33, 34, 39, 41, 56] }, // factura/exenta/boleta/ND
      ...sameRutFilter,
    },
    select: { id: true, totalAmount: true, status: true, payments: { select: { amountApplied: true } } },
  });
  if (!target) return false;

  // Setear la compensación lógica en la NC.
  await prisma.invoice.update({
    where: { id: nc.id },
    data: {
      compensationType: "other_invoice",
      appliedToInvoiceId: target.id,
      status: "pagada",
      paidAt: new Date(),
    },
  });

  // Actualizar status de la factura objetivo.
  const realPaid = target.payments.reduce((s, p) => s + p.amountApplied, 0);
  const ncAbs = Math.abs(nc.totalAmount);
  if (realPaid + ncAbs >= target.totalAmount - 10) {
    await prisma.invoice.update({
      where: { id: target.id },
      data: { status: "anulada", paidAt: new Date() },
    });
  } else if (realPaid <= 0 && ncAbs > 0) {
    await prisma.invoice.update({
      where: { id: target.id },
      data: { status: "parcial" },
    });
  }
  return true;
}
