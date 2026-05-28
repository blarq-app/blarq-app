// Helpers para manejar imputaciones movimiento↔factura (InvoicePayment).
//
// Una factura puede recibir cobros parciales (varios movimientos) y un
// movimiento puede aplicarse a varias facturas. La fuente de verdad del
// "cuánto está cobrado" de una factura es Σ(InvoicePayment.amountApplied)
// para esa factura — el campo Invoice.status es derivado.

import { prisma } from "@/lib/prisma";

/**
 * Recalcula el `status` y `paidAt` de una factura a partir de sus
 * InvoicePayment. Llamar después de crear/borrar/modificar pagos.
 *
 *   pendiente : 0 imputado
 *   parcial   : 0 < imputado < totalAmount
 *   pagada    : imputado >= totalAmount   (paidAt = max(date) de los movs)
 *
 * Tolera $1 de redondeo (CLP no tiene decimales pero la API devuelve floats).
 */
export async function recomputeInvoiceStatus(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { totalAmount: true, status: true },
  });
  if (!invoice) return;

  // status="anulada" no se toca — anulación es manual, no derivada.
  if (invoice.status === "anulada") return;

  const payments = await prisma.invoicePayment.findMany({
    where: { invoiceId },
    select: {
      amountApplied: true,
      bankMovement: { select: { date: true } },
    },
  });

  const sumApplied = payments.reduce((s, p) => s + p.amountApplied, 0);

  let nextStatus: "pendiente" | "parcial" | "pagada" = "pendiente";
  let paidAt: Date | null = null;

  if (sumApplied >= invoice.totalAmount - 1) {
    nextStatus = "pagada";
    // paidAt = fecha del último movimiento que cerró la factura.
    paidAt = payments.reduce<Date | null>((latest, p) => {
      const d = p.bankMovement.date;
      return !latest || d > latest ? d : latest;
    }, null);
  } else if (sumApplied > 0) {
    nextStatus = "parcial";
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: nextStatus, paidAt },
  });
}

/**
 * Devuelve cuánto del monto de un movimiento bancario ya está imputado
 * a facturas (suma de InvoicePayment.amountApplied para ese mov).
 * Útil para validar antes de asignar más imputaciones.
 */
export async function getMovementAppliedAmount(bankMovementId: string): Promise<number> {
  const r = await prisma.invoicePayment.aggregate({
    where: { bankMovementId },
    _sum: { amountApplied: true },
  });
  return r._sum.amountApplied ?? 0;
}

/**
 * Idem para una factura: cuánto está cobrado a la fecha.
 */
export async function getInvoicePaidAmount(invoiceId: string): Promise<number> {
  const r = await prisma.invoicePayment.aggregate({
    where: { invoiceId },
    _sum: { amountApplied: true },
  });
  return r._sum.amountApplied ?? 0;
}

/**
 * Auto-conciliación al emitir una factura nueva: busca movimientos
 * bancarios sin asignar del mismo RUT contraparte que matcheen el
 * monto exacto (caso típico MJ: te pagan, después emitís factura).
 *
 * Heurística conservadora — solo aplica si hay un único mov candidato:
 *   - mismo type opuesto (factura emitida → busca abono; recibida → cargo)
 *   - mismo RUT contraparte
 *   - status sin_asignar (no parcial todavía, evita pisar imputaciones)
 *   - |amount| coincide ±$10 con totalAmount
 *
 * Si encuentra exactamente un match, crea el InvoicePayment y actualiza
 * status del mov a "conciliado" + status de la factura a "pagada".
 *
 * Si hay 0 o múltiples candidatos, no toca nada — MJ resuelve manual.
 *
 * Devuelve cuántos movs auto-vinculó (0 o 1).
 */
/**
 * Devuelve las glosas de reembolsador cuyos aliases incluyen el RUT dado.
 * Caso de uso: una factura de "JPB Construcciones" (RUT empresa) puede
 * estar pagada por transferencias a "Jose Perez" (RUT persona) — el link
 * lo da el alias del reembolsador. Esto permite que la auto-conciliacion
 * matchee aunque el RUT del mov no sea el de la factura.
 *
 * Devuelve glosas en minuscula (como se guardan) para hacer `contains`
 * case-insensitive contra BankMovement.description.
 */
async function glosasForAliasRut(rutDigits: string): Promise<string[]> {
  if (rutDigits.length < 7) return [];
  // Buscamos aliases cuyo rut (normalizado) matchee el rut dado por
  // substring de ultimos 8 digitos (el banco a veces prefija con 0).
  const aliases = await prisma.reembolsadorAlias.findMany({
    select: { rut: true, reembolsador: { select: { glosa: true } } },
  });
  const tail = rutDigits.slice(-8);
  const glosas = new Set<string>();
  for (const a of aliases) {
    const aDigits = a.rut.replace(/\D/g, "");
    if (aDigits.length > 0 && (aDigits.includes(tail) || tail.includes(aDigits))) {
      glosas.add(a.reembolsador.glosa.toLowerCase());
    }
  }
  return [...glosas];
}

/**
 * Inverso de glosasForAliasRut: dado el texto de un movimiento, devuelve
 * los RUTs (en dígitos) de los aliases de los reembolsadores cuya glosa
 * aparece en esa descripción. Caso: mov "Transf a Jose Perez" → RUT de
 * JPB Construcciones (el alias de "jose perez").
 */
async function aliasRutsForMovementDescription(
  description: string
): Promise<string[]> {
  const desc = (description ?? "").toLowerCase();
  if (!desc) return [];
  const reembolsadores = await prisma.reembolsador.findMany({
    select: { glosa: true, aliases: { select: { rut: true } } },
  });
  const ruts = new Set<string>();
  for (const r of reembolsadores) {
    if (desc.includes(r.glosa.toLowerCase())) {
      for (const a of r.aliases) {
        const d = a.rut.replace(/\D/g, "");
        if (d.length > 0) ruts.add(d.slice(-8));
      }
    }
  }
  return [...ruts];
}

export async function tryAutoMatchInvoiceWithExistingMovs(invoiceId: string): Promise<number> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      type: true,
      tipoDoc: true,
      totalAmount: true,
      status: true,
      rutIssuer: true,
      rutReceiver: true,
      payments: { select: { id: true } },
    },
  });
  if (!inv) return 0;
  // Si la factura ya tiene pagos o no está pendiente, no tocar.
  if (inv.payments.length > 0 || inv.status !== "pendiente") return 0;
  // NCs no se "pagan" auto.
  if (inv.tipoDoc === 61) return 0;

  // Para emitidas, contraparte = cliente = rutReceiver (el cliente de BLARQ).
  // Para recibidas, contraparte = proveedor = rutIssuer.
  const counterpartyRut = inv.type === "emitida" ? inv.rutReceiver : inv.rutIssuer;
  if (!counterpartyRut) return 0;
  const counterpartyDigits = counterpartyRut.replace(/\D/g, "");
  if (counterpartyDigits.length < 7) return 0;

  // Filtro de monto según el lado del mov (cargo para recibida, abono
  // para emitida). Se reutiliza en las dos búsquedas de candidatos.
  const amountWhere =
    inv.type === "emitida"
      ? { amount: { gte: inv.totalAmount - 10, lte: inv.totalAmount + 10 } }
      : { amount: { gte: -(inv.totalAmount + 10), lte: -(inv.totalAmount - 10) } };

  // Candidatos por RUT directo: movs cuya contraparte es el mismo RUT
  // de la factura (caso normal — pago directo al proveedor/cliente).
  const byRut = await prisma.bankMovement.findMany({
    where: {
      status: "sin_asignar",
      counterpartyRut: { contains: counterpartyDigits.slice(-8) },
      ...amountWhere,
    },
    select: { id: true, amount: true, date: true },
    take: 5,
  });

  // Candidatos por alias de reembolsador: si la factura es de una empresa
  // (JPB) cuyo RUT está como alias de un reembolsador (Jose Perez), también
  // consideramos movs cuya descripción matchee la glosa de ese reembolsador,
  // aunque su counterpartyRut sea distinto (el RUT personal).
  const glosas = await glosasForAliasRut(counterpartyDigits);
  let byAlias: { id: string; amount: number; date: Date }[] = [];
  if (glosas.length > 0) {
    byAlias = await prisma.bankMovement.findMany({
      where: {
        status: "sin_asignar",
        OR: glosas.map((g) => ({
          description: { contains: g, mode: "insensitive" as const },
        })),
        ...amountWhere,
      },
      select: { id: true, amount: true, date: true },
      take: 5,
    });
  }

  // Unimos por id (un mov puede caer en ambas listas).
  const byId = new Map<string, { id: string; amount: number; date: Date }>();
  for (const m of [...byRut, ...byAlias]) byId.set(m.id, m);
  const candidates = [...byId.values()];

  // Solo auto-conciliamos si hay UN único candidato — si hay varios, es
  // ambiguo y lo dejamos para decisión manual.
  if (candidates.length !== 1) return 0;

  const mov = candidates[0];
  await prisma.invoicePayment.create({
    data: {
      bankMovementId: mov.id,
      invoiceId: inv.id,
      amountApplied: Math.abs(mov.amount),
    },
  });
  await prisma.bankMovement.update({
    where: { id: mov.id },
    data: { status: "conciliado" },
  });
  await recomputeInvoiceStatus(inv.id);
  return 1;
}

/**
 * Auto-match en la dirección movimiento → factura.
 *
 * Busca facturas pendientes/parciales con saldo restante ±$10 al monto
 * del movimiento. Si hay >1 candidato, desambigua por RUT contraparte
 * del banco. Si encuentra match único, crea el InvoicePayment y actualiza
 * status. Devuelve { matched: true, invoiceId } o { matched: false, reason }.
 *
 * Esta es la misma lógica que corre al importar una cartola (en
 * /api/banco/import) — extraída para reusarla en el endpoint de
 * "Auto-conciliar pendientes" sobre movs ya existentes.
 */
export async function tryAutoMatchMovementWithInvoices(
  movId: string
): Promise<{ matched: boolean; invoiceId?: string; reason?: string }> {
  const mov = await prisma.bankMovement.findUnique({
    where: { id: movId },
    include: { payments: true },
  });
  if (!mov) return { matched: false, reason: "mov_not_found" };
  if (mov.status === "interno") return { matched: false, reason: "interno" };
  if (mov.payments.length > 0) return { matched: false, reason: "already_has_payments" };

  const isCargo = mov.amount < 0;
  const targetType = isCargo ? "recibida" : "emitida";
  const absAmount = Math.abs(mov.amount);

  const rawCandidates = await prisma.invoice.findMany({
    where: {
      type: targetType,
      status: { in: ["pendiente", "parcial"] },
      tipoDoc: { not: 61 },
      totalAmount: { gte: absAmount - 10 },
    },
    select: {
      id: true,
      rutIssuer: true,
      rutReceiver: true,
      businessName: true,
      totalAmount: true,
      payments: { select: { amountApplied: true } },
    },
  });

  const candidates = rawCandidates
    .map((c) => {
      const paid = c.payments.reduce((s, p) => s + p.amountApplied, 0);
      return { ...c, remaining: c.totalAmount - paid };
    })
    .filter((c) => c.remaining >= absAmount - 10 && c.remaining <= absAmount + 10);

  if (candidates.length === 0) return { matched: false, reason: "no_candidates" };

  let match = candidates[0];
  if (candidates.length > 1) {
    // RUTs alias del reembolsador que matchee la glosa de este mov (caso
    // "Jose Perez" → facturas de JPB, RUT distinto). Los aceptamos como
    // válidos para desambiguar igual que el RUT directo del mov.
    const aliasRutDigits = await aliasRutsForMovementDescription(
      mov.description
    );
    const movRutDigits = (mov.counterpartyRut ?? "").replace(/\D/g, "");
    if (!movRutDigits && aliasRutDigits.length === 0) {
      return { matched: false, reason: "ambiguous_no_rut" };
    }
    const filtered = candidates.filter((c) => {
      const cRut = (isCargo ? c.rutIssuer : c.rutReceiver) ?? "";
      const cRutDigits = cRut.replace(/\D/g, "");
      if (cRutDigits.length === 0) return false;
      // Match por RUT directo del mov...
      if (
        movRutDigits &&
        (movRutDigits.includes(cRutDigits) || cRutDigits.includes(movRutDigits))
      ) {
        return true;
      }
      // ...o por alias de reembolsador (RUT empresa de la factura).
      return aliasRutDigits.some(
        (a) => a.includes(cRutDigits) || cRutDigits.includes(a)
      );
    });
    if (filtered.length !== 1) {
      // 0 = ningún candidato cuadra por RUT/alias. >1 = sigue ambiguo.
      return {
        matched: false,
        reason: filtered.length === 0 ? "no_rut_match" : "ambiguous_multi",
      };
    }
    match = filtered[0];
  }

  await prisma.invoicePayment.create({
    data: {
      bankMovementId: mov.id,
      invoiceId: match.id,
      amountApplied: absAmount,
    },
  });
  await prisma.bankMovement.update({
    where: { id: mov.id },
    data: { status: "conciliado" },
  });
  await recomputeInvoiceStatus(match.id);

  return { matched: true, invoiceId: match.id };
}
