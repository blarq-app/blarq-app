// Fuente ÚNICA de verdad del `status` de un movimiento bancario (BankMovement).
//
// Historia (2026-07-27): el status se escribía a mano con strings en 13 puntos
// repartidos en 8 archivos (import, PATCH del movimiento, bulk, reembolso de
// boletas, borrar pago desde la factura, compensar NC, auto-match, reglas).
// La cuenta "¿cuánto quedó imputado?" estaba copiada 4 veces, cada una con su
// umbral, y cuando un camino se olvidaba de recalcular quedaban contradicciones
// tipo "movimiento Pagado sin nada imputado" (ej.: borrar una factura borraba
// sus imputaciones en cascada y nadie recalculaba el movimiento). Desde este
// cambio, NINGÚN archivo fuera de este escribe el string del status a mano:
// o llama a las funciones de acá, o usa las constantes MOV_STATUS.
//
// El modelo de estados tiene dos familias:
//
//   DERIVADOS de las imputaciones (InvoicePayment) — la plata manda:
//     conciliado : imputado cubre el monto completo (tolerancia $1)
//     parcial    : hay algo imputado pero queda saldo libre
//   REPOSO cuando no hay nada imputado — acá la imputación no decide:
//     sin_factura : resuelto con categoría, sin documento (sueldo, previred…)
//     sin_asignar : en la cola Pendiente (puede tener categoría SUGERIDA por
//                   el import — por eso "tiene categoría" NO implica
//                   sin_factura; sin_factura es una decisión, no un derivado)
//   MODOS EXPLÍCITOS — se prenden/apagan con un gesto de MJ y el recompute
//   nunca los pisa:
//     interno    : transferencia BLARQ↔BLARQ (par linkeado)
//     neto_cero  : devolución que se cancela con su contraparte
//
// Espejo del lado factura: recomputeInvoiceStatus en invoicePayments.ts.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const MOV_STATUS = {
  SIN_ASIGNAR: "sin_asignar",
  PARCIAL: "parcial",
  CONCILIADO: "conciliado",
  SIN_FACTURA: "sin_factura",
  INTERNO: "interno",
  NETO_CERO: "neto_cero",
} as const;

export type MovementStatus = (typeof MOV_STATUS)[keyof typeof MOV_STATUS];

// Modos que se marcan a propósito (marcar interna / neto cero). El recompute
// los respeta: un interno sigue interno aunque no tenga imputaciones.
export function esModoExplicito(status: string | null | undefined): boolean {
  return status === MOV_STATUS.INTERNO || status === MOV_STATUS.NETO_CERO;
}

/**
 * Parte DERIVABLE del status: qué dice la plata imputada.
 * Devuelve null cuando no hay nada imputado — ahí el status lo decide el
 * estado de reposo (sin_asignar / sin_factura), no la imputación.
 *
 * Tolerancia $1 (CLP no tiene decimales pero la API devuelve floats) — el
 * mismo umbral que usaban las 4 copias que este helper reemplaza.
 */
export function statusPorImputacion(
  sumApplied: number,
  absAmount: number
): typeof MOV_STATUS.CONCILIADO | typeof MOV_STATUS.PARCIAL | null {
  if (sumApplied <= 0) return null;
  if (sumApplied >= absAmount - 1) return MOV_STATUS.CONCILIADO;
  return MOV_STATUS.PARCIAL;
}

/**
 * Status al ponerle / sacarle CATEGORÍA a un movimiento (categorizar, ignorar,
 * regla de proveedor). La imputación manda: si tiene plata imputada, el status
 * sigue siendo parcial/conciliado (antes, categorizar un movimiento con pagos
 * lo pisaba a sin_factura/sin_asignar contradiciendo sus imputaciones). Sin
 * imputación: con categoría queda resuelto (sin_factura), sin categoría vuelve
 * a la cola (sin_asignar).
 */
export function statusAlCategorizar(
  sumApplied: number,
  absAmount: number,
  category: string | null
): MovementStatus {
  const porImputacion = statusPorImputacion(sumApplied, absAmount);
  if (porImputacion) return porImputacion;
  return category ? MOV_STATUS.SIN_FACTURA : MOV_STATUS.SIN_ASIGNAR;
}

/**
 * Recalcula el status de un movimiento leyendo sus imputaciones reales de la
 * base, y lo escribe si cambió. Llamar después de crear/borrar/modificar
 * InvoicePayment de ese movimiento — incluido cuando los pagos se van en
 * CASCADA (borrar una factura), que era el hueco donde nacían los "Pagado"
 * fantasma.
 *
 * Reglas:
 *  - interno / neto_cero no se tocan (modos explícitos).
 *  - hay imputación → parcial / conciliado según cubra el monto.
 *  - no hay imputación → si venía de parcial/conciliado, perdió lo imputado y
 *    vuelve a la cola (sin_asignar). Si estaba en reposo (sin_asignar /
 *    sin_factura) se queda como está: un sueldo sin_factura no tiene pagos y
 *    eso no lo hace pendiente.
 *
 * Caso borde cubierto a propósito: un movimiento "conciliado" SIN pagos existe
 * legítimamente cuando lo salda una Nota de Crédito (compensar, bank_refund).
 * Este recompute solo lo alcanza si se borra esa NC — y ahí bajarlo a
 * sin_asignar es exactamente lo correcto.
 */
export async function recomputeMovementStatus(
  movementId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<MovementStatus | null> {
  const mov = await db.bankMovement.findUnique({
    where: { id: movementId },
    select: {
      id: true,
      amount: true,
      status: true,
      payments: { select: { amountApplied: true } },
    },
  });
  if (!mov) return null;
  if (esModoExplicito(mov.status)) return mov.status as MovementStatus;

  const sumApplied = mov.payments.reduce((s, p) => s + p.amountApplied, 0);
  const porImputacion = statusPorImputacion(sumApplied, Math.abs(mov.amount));

  let next: MovementStatus;
  if (porImputacion) {
    next = porImputacion;
  } else if (
    mov.status === MOV_STATUS.CONCILIADO ||
    mov.status === MOV_STATUS.PARCIAL
  ) {
    next = MOV_STATUS.SIN_ASIGNAR;
  } else {
    next = (mov.status as MovementStatus) ?? MOV_STATUS.SIN_ASIGNAR;
  }

  if (next !== mov.status) {
    await db.bankMovement.update({
      where: { id: movementId },
      data: { status: next },
    });
  }
  return next;
}

/** Recompute de a varios (acciones masivas, borrar factura con varios pagos). */
export async function recomputeMovementsStatus(
  movementIds: string[],
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  for (const id of Array.from(new Set(movementIds))) {
    await recomputeMovementStatus(id, db);
  }
}
