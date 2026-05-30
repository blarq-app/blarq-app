import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { recomputeInvoiceStatus } from "@/lib/banco/invoicePayments";

// POST /api/banco/auto-conciliar-pendientes
//
// Aplica retroactivamente la lógica de auto-match a todos los movimientos
// bancarios sin imputaciones que están en estado "sin_asignar" o
// "sin_factura". Útil para limpiar movs viejos que en su momento no
// calzaron con una factura (porque la factura SII todavía no había
// llegado, o había ambigüedad).
//
// Implementación en lote: trae todos los movs y todas las facturas
// candidatas en 2 queries iniciales y matchea en memoria, después aplica
// los inserts/updates en serie. Eso evita el patrón N×M de queries que
// hacía la versión anterior (que tardaba >60s con cientos de movs).
//
// Devuelve: { tried, matched, byReason: {...} }
export async function POST() {
  // 1) Movs candidatos: pendientes de conciliar, sin payments, no internos.
  const movs = await prisma.bankMovement.findMany({
    where: {
      status: { in: ["sin_asignar", "sin_factura"] },
      payments: { none: {} },
    },
    select: {
      id: true,
      amount: true,
      counterpartyRut: true,
    },
  });

  // 2) Facturas candidatas: pendientes/parciales, no NCs.
  // Traemos las sumas de payments existentes para calcular saldo.
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: ["pendiente", "parcial"] },
      tipoDoc: { not: 61 },
    },
    select: {
      id: true,
      type: true,
      rutIssuer: true,
      rutReceiver: true,
      totalAmount: true,
      payments: { select: { amountApplied: true } },
    },
  });

  type InvCandidate = {
    id: string;
    type: string;
    rutIssuer: string | null;
    rutReceiver: string | null;
    remaining: number;
  };
  const candidatesByType = { recibida: [] as InvCandidate[], emitida: [] as InvCandidate[] };
  for (const inv of invoices) {
    const paid = inv.payments.reduce((s, p) => s + p.amountApplied, 0);
    const remaining = inv.totalAmount - paid;
    const c: InvCandidate = {
      id: inv.id,
      type: inv.type,
      rutIssuer: inv.rutIssuer,
      rutReceiver: inv.rutReceiver,
      remaining,
    };
    if (inv.type === "recibida") candidatesByType.recibida.push(c);
    else candidatesByType.emitida.push(c);
  }

  const stats = {
    tried: movs.length,
    matched: 0,
    byReason: {} as Record<string, number>,
  };

  // 3) Loop en memoria + serial commits.
  for (const mov of movs) {
    const isCargo = mov.amount < 0;
    const targetType = isCargo ? "recibida" : "emitida";
    const absAmount = Math.abs(mov.amount);

    const pool = candidatesByType[targetType];
    const matchAmount = (c: InvCandidate) =>
      c.remaining >= absAmount - 10 && c.remaining <= absAmount + 10;
    const candidates = pool.filter(matchAmount);

    if (candidates.length === 0) {
      stats.byReason["no_candidates"] = (stats.byReason["no_candidates"] ?? 0) + 1;
      continue;
    }

    let match = candidates[0];
    if (candidates.length > 1) {
      if (!mov.counterpartyRut) {
        stats.byReason["ambiguous_no_rut"] =
          (stats.byReason["ambiguous_no_rut"] ?? 0) + 1;
        continue;
      }
      const movRutDigits = mov.counterpartyRut.replace(/\D/g, "");
      const filtered = candidates.filter((c) => {
        const cRut = (isCargo ? c.rutIssuer : c.rutReceiver) ?? "";
        const cRutDigits = cRut.replace(/\D/g, "");
        return (
          cRutDigits.length > 0 &&
          (movRutDigits.includes(cRutDigits) || cRutDigits.includes(movRutDigits))
        );
      });
      if (filtered.length === 0) {
        stats.byReason["no_rut_match"] = (stats.byReason["no_rut_match"] ?? 0) + 1;
        continue;
      }
      match = filtered[0];
    }

    // Commit. Excluir esta factura del pool para que no se duplique en el
    // siguiente match. (El saldo se ajusta también, por si quedaba con
    // remaining > 0 después de este pago.)
    await prisma.invoicePayment.create({
      data: {
        bankMovementId: mov.id,
        invoiceId: match.id,
        amountApplied: absAmount,
        autoMatched: true, // creada por el auto-match
      },
    });
    await prisma.bankMovement.update({
      where: { id: mov.id },
      data: { status: "conciliado" },
    });
    await recomputeInvoiceStatus(match.id);

    match.remaining -= absAmount;
    if (match.remaining < 1) {
      // Sacar del pool (se cubrió el total).
      const idx = pool.indexOf(match);
      if (idx >= 0) pool.splice(idx, 1);
    }

    stats.matched++;
  }

  return NextResponse.json(stats);
}
