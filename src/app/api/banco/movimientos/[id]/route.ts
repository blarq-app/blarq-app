import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { cleanupInvoicesAfterUnassign } from "@/lib/banco/invoicePayments";
import { upsertRuleFromMovement } from "@/lib/banco/categorizationRules";
import { requireSession } from "@/lib/apiAuth";
import { SOCIO_RUTS, esCategoriaPrestamoSocio } from "@/lib/banco/socios";

// PATCH /api/banco/movimientos/[id]
//
// Asigna un movimiento bancario manualmente. Acepta:
//   { payments: [{ invoiceId, amountApplied }] }
//                              → reemplaza TODAS las imputaciones del mov.
//                                Permite splits ($7M abono → $5M factura A
//                                + $2M factura B). Si payments=[], desvincula
//                                todo y vuelve a sin_asignar.
//   { invoiceId: string }      → atajo: imputar el mov completo (|amount|)
//                                contra una factura. Equivalente a payments
//                                con un solo elemento.
//   { invoiceId: null }        → atajo: desvincular todo. Equivalente a
//                                payments=[].
//   { category: string }       → categorizar como sueldo/previred/etc (sin factura).
//                                Por sí solo NO crea regla de auto-categorización.
//   { category, saveRule:true } → además guarda una regla para que movs futuros
//                                con descripción similar se categoricen solos.
//                                Opt-in: el patrón se deriva de la glosa y puede
//                                quedar amplio (ej "Transf a Juan"), por eso no
//                                es el default.
//   { ignore: true }           → marcar como "sin_factura" sin categoría
//   { markInternal: true }     → marcar como transferencia interna BLARQ↔BLARQ
//   { notes: string }          → agregar nota
//
// Cuando se cambia la imputación, las facturas previa y nueva
// recalculan su status (pendiente/parcial/pagada) automáticamente.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    const body = (await request.json()) as Partial<{
      payments: Array<{ invoiceId: string; amountApplied: number }>;
      invoiceId: string | null;
      category: string | null;
      saveRule: boolean;
      ignore: boolean;
      markInternal: boolean;
      undoNetZero: boolean;
      // Conciliar una transferencia interna (Operativa→Sueldos) a una obra.
      // string = id de la obra; null = desasignar. Etiqueta AMBOS lados del
      // par linkeado (ver branch más abajo).
      internalProjectId: string | null;
      // Concepto del traspaso de utilidad (transferencia interna): "obra" |
      // "muebles" | null. Se setea en los dos lados del par.
      internalConcepto: string | null;
      // A qué mes corresponde un sueldo/previred, formato "YYYY-MM" (o null para
      // volver al default por fecha). Ver src/lib/banco/salaryPeriod.ts.
      salaryPeriod: string | null;
      // A qué socio corresponde un préstamo/devolución cuando la plata fue a un
      // tercero por cuenta del socio. RUT sin puntos ni DV; null = limpiar.
      socioRut: string | null;
      notes: string;
    }>;

    const mov = await prisma.bankMovement.findUnique({
      where: { id },
      include: { payments: true },
    });
    if (!mov) return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 });

    // Asignar / desasignar OBRA a una transferencia interna. Una transferencia
    // son DOS movimientos linkeados (sale −X de Operativa, entra +X a Sueldos):
    // etiquetamos los dos lados a la vez para que la obra quede conciliada sin
    // importar en cuál fila clickeó MJ. El cálculo de "transferido por obra"
    // suma SOLO el lado que entra a Sueldos (ver fondoSueldos.ts), así que
    // etiquetar ambos lados no produce doble conteo.
    if (body.internalProjectId !== undefined) {
      if (mov.category !== "transfer_interno" && mov.status !== "interno") {
        return NextResponse.json(
          { error: "Solo se puede asignar obra a transferencias internas" },
          { status: 400 }
        );
      }
      if (body.internalProjectId) {
        const existe = await prisma.project.count({ where: { id: body.internalProjectId } });
        if (!existe) return NextResponse.json({ error: "La obra no existe" }, { status: 400 });
      }
      // Ambos lados del par. La relación internalTransferToId se setea en los
      // dos sentidos al importar, pero por si algún dato viejo solo tiene un
      // lado, buscamos también el que apunta a este mov.
      const ids = new Set<string>([mov.id]);
      if (mov.internalTransferToId) ids.add(mov.internalTransferToId);
      const back = await prisma.bankMovement.findFirst({
        where: { internalTransferToId: mov.id },
        select: { id: true },
      });
      if (back) ids.add(back.id);
      const r = await prisma.bankMovement.updateMany({
        where: { id: { in: Array.from(ids) } },
        data: { projectId: body.internalProjectId },
      });
      return NextResponse.json({ ok: true, etiquetados: r.count });
    }

    // Asignar / desasignar CONCEPTO (obra | muebles) a una transferencia interna
    // — de qué utilidad es el traspaso. Mismo criterio que la obra: se setea en
    // los dos lados del par.
    if (body.internalConcepto !== undefined) {
      if (mov.category !== "transfer_interno" && mov.status !== "interno") {
        return NextResponse.json(
          { error: "Solo se puede asignar concepto a transferencias internas" },
          { status: 400 }
        );
      }
      if (body.internalConcepto && !["obra", "muebles"].includes(body.internalConcepto)) {
        return NextResponse.json({ error: "Concepto inválido" }, { status: 400 });
      }
      const ids = new Set<string>([mov.id]);
      if (mov.internalTransferToId) ids.add(mov.internalTransferToId);
      const back = await prisma.bankMovement.findFirst({
        where: { internalTransferToId: mov.id },
        select: { id: true },
      });
      if (back) ids.add(back.id);
      const r = await prisma.bankMovement.updateMany({
        where: { id: { in: Array.from(ids) } },
        data: { internalConcepto: body.internalConcepto },
      });
      return NextResponse.json({ ok: true, etiquetados: r.count });
    }

    // Marcar a qué MES corresponde un sueldo/previred (formato "YYYY-MM", o
    // null para volver al default por fecha). Solo aplica a esas categorías —
    // el resto no tiene "mes que corresponde". No toca el par ni el status.
    if (body.salaryPeriod !== undefined) {
      if (mov.category !== "sueldo" && mov.category !== "previred") {
        return NextResponse.json(
          { error: "Solo se puede marcar el mes en sueldos y Previred" },
          { status: 400 }
        );
      }
      if (body.salaryPeriod !== null && !/^\d{4}-\d{2}$/.test(body.salaryPeriod)) {
        return NextResponse.json({ error: "Mes inválido (se espera YYYY-MM)" }, { status: 400 });
      }
      await prisma.bankMovement.update({
        where: { id: mov.id },
        data: { salaryPeriod: body.salaryPeriod },
      });
      return NextResponse.json({ ok: true });
    }

    // Marcar a QUÉ SOCIO corresponde un préstamo/devolución cuando la plata fue
    // a un tercero por cuenta del socio (caso real: $500k a Rojas Mella por
    // cuenta de JT). Solo aplica a esas categorías — el resto no tiene socio
    // detrás. null = limpiar la marca (la contraparte vuelve a mandar).
    if (body.socioRut !== undefined) {
      if (!esCategoriaPrestamoSocio(mov.category)) {
        return NextResponse.json(
          { error: "Solo se puede marcar el socio en préstamos y devoluciones de socio" },
          { status: 400 }
        );
      }
      if (body.socioRut !== null && !SOCIO_RUTS.includes(body.socioRut)) {
        return NextResponse.json({ error: "Socio inválido" }, { status: 400 });
      }
      await prisma.bankMovement.update({
        where: { id: mov.id },
        data: { socioRut: body.socioRut },
      });
      return NextResponse.json({ ok: true });
    }

    // Deshacer una devolución neto cero: suelta TODO el grupo (un lavado es
    // atómico — deshacer uno deshace todos). Vuelven a "pendiente".
    if (body.undoNetZero) {
      const where = mov.netZeroGroupId
        ? { netZeroGroupId: mov.netZeroGroupId }
        : { id: mov.id };
      const r = await prisma.bankMovement.updateMany({
        where,
        data: { status: "sin_asignar", netZeroGroupId: null },
      });
      return NextResponse.json({ ok: true, deshechos: r.count });
    }

    // Normalizar el atajo invoiceId al shape de payments[].
    let nextPayments: Array<{ invoiceId: string; amountApplied: number }> | undefined;
    if (body.payments !== undefined) {
      nextPayments = body.payments;
    } else if (body.invoiceId !== undefined) {
      nextPayments = body.invoiceId
        ? [{ invoiceId: body.invoiceId, amountApplied: Math.abs(mov.amount) }]
        : [];
    }

    // Si está cambiando la imputación, validar y aplicar.
    if (nextPayments !== undefined) {
      // Validaciones
      const absAmount = Math.abs(mov.amount);
      const sumApplied = nextPayments.reduce((s, p) => s + p.amountApplied, 0);
      if (sumApplied > absAmount + 1) {
        return NextResponse.json(
          { error: `Suma de imputaciones (${sumApplied}) excede el monto del movimiento (${absAmount})` },
          { status: 400 }
        );
      }
      if (nextPayments.some((p) => p.amountApplied <= 0)) {
        return NextResponse.json({ error: "Cada amountApplied debe ser positivo" }, { status: 400 });
      }
      // Validar que las facturas existen
      if (nextPayments.length > 0) {
        const ids = nextPayments.map((p) => p.invoiceId);
        const existing = await prisma.invoice.count({ where: { id: { in: ids } } });
        if (existing !== ids.length) {
          return NextResponse.json({ error: "Alguna factura no existe" }, { status: 400 });
        }
      }

      // Facturas previas afectadas (para recalcular su status después).
      const previousInvoiceIds = mov.payments.map((p) => p.invoiceId);
      const nextInvoiceIds = nextPayments.map((p) => p.invoiceId);
      const affectedInvoiceIds = Array.from(new Set([...previousInvoiceIds, ...nextInvoiceIds]));

      // Replace transaccional: delete + create todos los pagos del mov.
      await prisma.$transaction([
        prisma.invoicePayment.deleteMany({ where: { bankMovementId: id } }),
        ...nextPayments.map((p) =>
          prisma.invoicePayment.create({
            data: {
              bankMovementId: id,
              invoiceId: p.invoiceId,
              amountApplied: p.amountApplied,
            },
          })
        ),
      ]);

      // Recalcular status de las facturas afectadas y, si alguna era un "pago
      // sin factura" sintético que quedó sin imputaciones, borrarla. La lógica
      // vive en cleanupInvoicesAfterUnassign — compartida con la acción masiva
      // "Desasignar" para que "Editar" y "Desasignar" limpien igual (antes
      // "Editar" no borraba el sin_respaldo → huérfano/gasto fantasma).
      await cleanupInvoicesAfterUnassign(affectedInvoiceIds);
    }

    // Status del movimiento + otros campos.
    //   sin_asignar : 0 imputado
    //   parcial     : 0 < imputado < |amount|  (todavía hay saldo libre)
    //   conciliado  : imputado >= |amount|     (totalmente imputado)
    const update: Record<string, unknown> = {};
    if (nextPayments !== undefined) {
      const sumApplied = nextPayments.reduce((s, p) => s + p.amountApplied, 0);
      const absAmount = Math.abs(mov.amount);
      if (sumApplied <= 0) update.status = "sin_asignar";
      else if (sumApplied >= absAmount - 1) update.status = "conciliado";
      else update.status = "parcial";
      // Limpiar categoría cuando se imputa a factura (la factura tiene su propia categoría).
      if (nextPayments.length > 0) update.category = null;
    }
    if (body.category !== undefined) {
      update.category = body.category;
      update.status = body.category ? "sin_factura" : "sin_asignar";
      // La regla de auto-categorización solo se crea si MJ lo pide explícito
      // (saveRule). El patrón se deriva de la glosa y puede quedar amplio
      // ("Transf a Juan" atraparía a cualquier Juan), por eso es opt-in.
      if (body.category && body.saveRule) {
        await upsertRuleFromMovement(mov.description, body.category).catch(() => {});
      }
    }
    if (body.ignore) {
      update.status = "sin_factura";
      update.category = "otro_sin_factura";
    }
    if (body.markInternal) {
      // Transfer interna BLARQ↔BLARQ. Limpia categoría — se identifica por
      // el status. NO crea regla porque la detección por descripción ya la
      // hace el parser de cartola.
      update.status = "interno";
      update.category = null;
    }
    if (body.notes !== undefined) update.notes = body.notes;

    const updated = await prisma.bankMovement.update({
      where: { id },
      data: update,
      include: { payments: { include: { invoice: { select: { folioNumber: true, businessName: true, totalAmount: true, status: true } } } } },
    });
    return NextResponse.json({ ok: true, movement: updated });
  } catch (error) {
    console.error("Error patch movement:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error" },
      { status: 500 }
    );
  }
}
