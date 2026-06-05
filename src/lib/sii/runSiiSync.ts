// Lógica central del sync de facturas del SII → app.
//
// Lee los DTEs DIRECTO del Registro de Compras y Ventas del SII con el
// certificado digital de BLARQ (siiDteReader). Antes esto pasaba por
// SimpleFactura (servicio pago); ya no — el SII entrega la misma data gratis.
// SimpleFactura quedó solo como tipos + datos mock para dev sin certificado.
//
// Idempotente: usa el constraint @@unique([type, tipoDoc, folioNumber, rutIssuer])
// para hacer upsert sin duplicar.
//
// Las facturas que llegan del SII se guardan con:
//   - origin: "sii_automatica"
//   - projectId: null (MJ asigna después manualmente)
//   - categoryId: null (MJ asigna después manualmente)
//
// Se llama desde dos lugares con la misma firma:
//   - el botón "Sincronizar SII" (route /api/sii/sync) — corre en Vercel.
//   - el script local scripts/sync-sii-dtes.ts — corre en la mac de MJ.
// El script local es el camino confiable: el portal del SII tiene WAF que
// puede bloquear IPs de la nube. Si el botón en Vercel funciona, mejor; si
// no, el job local cubre igual.

import { prisma } from "@/lib/prisma";
import { tryAutoMatchInvoiceWithExistingMovs } from "@/lib/banco/invoicePayments";
import { applyInvoiceRule } from "@/lib/facturas/categorizationRules";
import { applyPendingTagsForInvoice } from "@/lib/facturas/pendingTags";
import { mockDTEs, type RemoteDTE } from "@/lib/sii/simpleFacturaClient";
import { fetchDTEsFromSII, isSiiReaderAvailable } from "@/lib/sii/siiDteReader";
import { linkNcReferences } from "@/lib/sii/linkNcReferences";

export interface SyncOptions {
  fromDate: string; // YYYY-MM-DD
  toDate?: string; // YYYY-MM-DD, default = hoy
  types?: ("emitida" | "recibida")[]; // default = ambos
}

// Fecha de corte histórica: el primer sync de MJ trajo desde el 1-abr-2026.
// Solo se usa como respaldo cuando todavía NO hay ninguna factura del SII
// guardada (base recién creada). En operación normal la fecha la deduce
// getDefaultSyncFrom() de las facturas ya traídas.
export const SII_SYNC_FALLBACK_FROM = "2026-04-01";

// Calcula SOLA desde qué fecha sincronizar cuando el usuario no elige una.
// Mira la factura del SII más reciente que ya está guardada y arranca desde
// el primer día del MES ANTERIOR a su emisión. Ese mes de colchón cubre el
// caso de que el SII publique tarde una factura del período previo (los DTEs
// aparecen en el RCV con algún retraso). Como el sync es idempotente
// (upsert por la unique key), re-traer ese colchón no duplica nada.
//
// Las fechas de emisión se guardan a medianoche UTC, así que el cálculo del
// mes se hace en UTC para no correrse un día por la zona horaria de Chile.
export async function getDefaultSyncFrom(): Promise<string> {
  const latest = await prisma.invoice.findFirst({
    where: { origin: "sii_automatica" },
    orderBy: { issueDate: "desc" },
    select: { issueDate: true },
  });
  if (!latest) return SII_SYNC_FALLBACK_FROM;
  const d = latest.issueDate;
  // Date.UTC con mes -1 hace bien el rollover de enero → diciembre anterior.
  const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return from.toISOString().slice(0, 10);
}

export interface SyncResult {
  ok: true;
  fromDate: string;
  toDate: string;
  created: number;
  updated: number;
  unchanged: number;
  ncLinked: number;
  mockMode: boolean;
}

export async function runSiiSync(opts: SyncOptions): Promise<SyncResult> {
  const { fromDate } = opts;
  const toDate = opts.toDate ?? new Date().toISOString().slice(0, 10);
  const types = opts.types ?? ["recibida", "emitida"];

  // Si hay certificado configurado, leemos directo del SII. Si no (dev sin
  // cert), caemos a datos mock para poder probar la UI.
  const useReal = isSiiReaderAvailable();

  const stats = { created: 0, updated: 0, unchanged: 0 };

  for (const type of types) {
    const remoteDTEs = useReal
      ? await fetchDTEsFromSII({ type, fromDate, toDate })
      : mockDTEs({ type, fromDate, toDate });
    for (const dte of remoteDTEs) {
      const result = await upsertInvoice(dte);
      stats[result]++;
    }
  }

  // Auto-link de NCs recibidas con sus facturas referenciadas usando el
  // SII directo (cert digital). Solo procesa NCs sin reference todavía.
  // En modo mock se skip — los datos sintéticos no existen en SII real.
  let ncLinked = 0;
  if (useReal) {
    try {
      const r = await linkNcReferences();
      ncLinked = r.linked;
    } catch (e) {
      console.warn("[SII sync] linkNcReferences falló:", e);
    }
  }

  return {
    ok: true,
    fromDate,
    toDate,
    ncLinked,
    mockMode: !useReal,
    ...stats,
  };
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
    // Aplicar etiquetas de centro de costo "en espera": si MJ/JT
    // fotografiaron esta factura desde Telegram antes de que llegara por
    // el SII, acá se asigna la obra que indicaron. Corre DESPUÉS de la
    // regla por RUT: la regla por proveedor casi nunca trae proyecto (los
    // proveedores son transversales), así que la etiqueta es la que
    // completa el centro de costo. applyTagToInvoice respeta lo ya seteado.
    await applyPendingTagsForInvoice(created.id).catch(() => 0);
    // Auto-conciliar contra movimientos bancarios sin asignar previos
    // del mismo RUT (caso típico: te pagaron, después llega la factura
    // sincronizada del SII).
    await tryAutoMatchInvoiceWithExistingMovs(created.id).catch(() => 0);
    return "created";
  }

  // Si ya existía: aplicar regla si quedó con categoría o proyecto
  // vacío. Esto cubre el caso donde la factura entró al sync ANTES de
  // que existiera la regla del proveedor, y después MJ creó la regla
  // — la factura existente quedaba sin completar para siempre porque
  // este branch no la tocaba. applyInvoiceRule respeta lo manual (no
  // pisa lo ya asignado), así que es seguro llamarla siempre.
  if (!existing.categoryId || !existing.projectId) {
    await applyInvoiceRule(existing.id).catch(() => ({ applied: false }));
    // Mismo motivo que en el create: una factura pudo entrar al sync antes
    // de que MJ/JT la fotografiaran. Si quedó sin proyecto, intentamos
    // aplicar una etiqueta en espera que haya aparecido después.
    await applyPendingTagsForInvoice(existing.id).catch(() => 0);
  }

  // Después actualizar montos si cambiaron. Preservamos projectId /
  // categoryId / status (lo que MJ haya asignado manualmente).
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
