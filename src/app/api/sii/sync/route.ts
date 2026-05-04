import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { tryAutoMatchInvoiceWithExistingMovs } from "@/lib/banco/invoicePayments";
import { applyInvoiceRule } from "@/lib/facturas/categorizationRules";
import {
  fetchDTEs,
  isMockMode,
  type RemoteDTE,
} from "@/lib/sii/simpleFacturaClient";
import { linkNcReferences } from "@/lib/sii/linkNcReferences";

// Sincroniza facturas del SII (vía OpenFactura) hacia la app.
// Idempotente: usa el constraint @@unique([type, tipoDoc, folioNumber, rutIssuer])
// para hacer upsert sin duplicar.
//
// Las facturas que llegan del SII se guardan con:
//   - origin: "sii_automatica"
//   - projectId: null (MJ asigna después manualmente)
//   - categoryId: null (MJ asigna después manualmente)
//
// Query params:
//   ?from=YYYY-MM-DD  (opcional, default = primer día del mes actual)
//   ?to=YYYY-MM-DD    (opcional, default = hoy)
//   ?type=emitida|recibida (opcional, si falta hace ambos)
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fromDate =
      searchParams.get("from") ??
      new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        .toISOString()
        .slice(0, 10);
    const toDate = searchParams.get("to") ?? undefined;
    const typeFilter = searchParams.get("type") as
      | "emitida"
      | "recibida"
      | null;

    const types: ("emitida" | "recibida")[] =
      typeFilter ? [typeFilter] : ["recibida", "emitida"];

    const stats = {
      created: 0,
      updated: 0,
      unchanged: 0,
      mockMode: isMockMode(),
    };

    for (const type of types) {
      const remoteDTEs = await fetchDTEs({ type, fromDate, toDate });
      for (const dte of remoteDTEs) {
        const result = await upsertInvoice(dte);
        stats[result]++;
      }
    }

    // Auto-link de NCs recibidas con sus facturas referenciadas usando el
    // SII directo (cert digital). Solo procesa NCs sin reference todavía.
    // En modo mock se skip — los datos sintéticos no existen en SII real.
    let ncLinked = 0;
    if (!stats.mockMode) {
      try {
        const r = await linkNcReferences();
        ncLinked = r.linked;
      } catch (e) {
        console.warn("[SII sync] linkNcReferences falló:", e);
      }
    }

    return NextResponse.json({
      ok: true,
      fromDate,
      toDate: toDate ?? new Date().toISOString().slice(0, 10),
      ncLinked,
      ...stats,
    });
  } catch (error) {
    console.error("Error sincronizando SII:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Error al sincronizar SII",
      },
      { status: 500 }
    );
  }
}

// Upsert por la unique key (type, tipoDoc, folioNumber, rutIssuer).
// Devuelve si fue created / updated / unchanged.
async function upsertInvoice(
  dte: RemoteDTE
): Promise<"created" | "updated" | "unchanged"> {
  const existing = await prisma.invoice.findFirst({
    where: {
      type: dte.type,
      tipoDoc: dte.tipoDoc,
      folioNumber: dte.folioNumber,
      rutIssuer: dte.rutIssuer,
    },
  });

  const data = {
    type: dte.type,
    tipoDoc: dte.tipoDoc,
    folioNumber: dte.folioNumber,
    rutIssuer: dte.rutIssuer,
    rutReceiver: dte.rutReceiver,
    businessName: dte.businessName,
    issueDate: new Date(dte.issueDate),
    netAmount: dte.netAmount,
    iva: dte.iva,
    totalAmount: dte.totalAmount,
    siiTrackId: dte.siiTrackId ?? null,
    xmlUrl: dte.xmlUrl ?? null,
    pdfUrl: dte.pdfUrl ?? null,
    syncedAt: new Date(),
    origin: "sii_automatica",
  };

  if (!existing) {
    const created = await prisma.invoice.create({
      data: { ...data, status: "pendiente" },
    });
    // Aplicar regla de categorización por RUT si existe.
    await applyInvoiceRule(created.id).catch(() => ({ applied: false }));
    // Auto-conciliar contra movimientos bancarios sin asignar previos
    // del mismo RUT (caso típico: te pagaron, después llega la factura
    // sincronizada del SII).
    await tryAutoMatchInvoiceWithExistingMovs(created.id).catch(() => 0);
    return "created";
  }

  // Si ya existía: solo actualizar si cambió algún monto. Preservamos
  // projectId / categoryId / status (lo que MJ haya asignado manualmente).
  const changed =
    existing.netAmount !== dte.netAmount ||
    existing.iva !== dte.iva ||
    existing.totalAmount !== dte.totalAmount ||
    existing.businessName !== dte.businessName ||
    existing.siiTrackId !== (dte.siiTrackId ?? null);

  if (!changed) return "unchanged";

  await prisma.invoice.update({
    where: { id: existing.id },
    data: {
      netAmount: dte.netAmount,
      iva: dte.iva,
      totalAmount: dte.totalAmount,
      businessName: dte.businessName,
      siiTrackId: dte.siiTrackId ?? existing.siiTrackId,
      xmlUrl: dte.xmlUrl ?? existing.xmlUrl,
      pdfUrl: dte.pdfUrl ?? existing.pdfUrl,
      syncedAt: new Date(),
    },
  });
  return "updated";
}
