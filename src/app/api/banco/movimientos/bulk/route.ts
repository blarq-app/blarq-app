import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { recomputeInvoiceStatus } from "@/lib/banco/invoicePayments";
import { requireSession } from "@/lib/apiAuth";

// RUT de BLARQ — receptor de las facturas/pagos recibidos.
const BLARQ_RUT = "77270733-9";

// POST /api/banco/movimientos/bulk
//
// Acciones masivas sobre movimientos bancarios. MJ las usa para "rehacer
// la conciliación" cuando un lote quedó mal imputado.
//
//   { action: "desasignar", movementIds: [] }
//      → borra todos los InvoicePayment de esos movs y los devuelve a
//        status "sin_asignar". Las facturas que pierden imputación
//        recalculan su status. Si una factura era un "pago sin respaldo"
//        (origin="sin_respaldo") y queda sin imputaciones, se borra — fue
//        un registro auto-creado que sin el movimiento no significa nada.
//
//   { action: "asignar", movementIds: [], invoiceId }
//      → imputa cada mov elegido a la factura, cada uno como un pago por
//        su monto completo (|amount|). Si el mov ya tenía imputaciones,
//        se reemplazan (replace, no se suma). status del mov → conciliado.
//
//   { action: "pago_sin_factura", movementIds: [], projectId, categoryId }
//      → para pagos a maestros/proveedores que NO emiten documento. Por
//        cada mov sin imputaciones crea un registro de costo "sin
//        respaldo" (Invoice type=recibida, tipoDoc=1043, sin IVA, con el
//        monto y la contraparte del movimiento), lo asigna al proyecto +
//        categoría, y lo deja conciliado contra el movimiento. Así el
//        gasto entra en los costos del proyecto sin que exista factura.
//        Omite movs que ya tienen imputaciones o que no son egresos.
//
// No toca movimientos "interno".
export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const body = (await request.json()) as Partial<{
      action: "desasignar" | "asignar" | "pago_sin_factura";
      movementIds: string[];
      invoiceId: string;
      projectId: string;
      categoryId: string;
    }>;

    const action = body.action;
    const movementIds = body.movementIds ?? [];
    if (
      action !== "desasignar" &&
      action !== "asignar" &&
      action !== "pago_sin_factura"
    ) {
      return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
    }
    if (movementIds.length === 0) {
      return NextResponse.json({ error: "Sin movimientos seleccionados" }, { status: 400 });
    }

    const movs = await prisma.bankMovement.findMany({
      where: { id: { in: movementIds } },
      include: { payments: { select: { invoiceId: true } } },
    });
    // Internos no participan de imputaciones — se descartan en silencio.
    const targetMovs = movs.filter((m) => m.status !== "interno");
    if (targetMovs.length === 0) {
      return NextResponse.json(
        { error: "Ningún movimiento seleccionado es imputable (¿todos internos?)" },
        { status: 400 }
      );
    }

    // ── DESASIGNAR ─────────────────────────────────────────────────────
    if (action === "desasignar") {
      const ids = targetMovs.map((m) => m.id);
      // Facturas que van a perder imputación — recalcular su status después.
      const affectedInvoiceIds = Array.from(
        new Set(targetMovs.flatMap((m) => m.payments.map((p) => p.invoiceId)))
      );

      await prisma.$transaction([
        prisma.invoicePayment.deleteMany({ where: { bankMovementId: { in: ids } } }),
        prisma.bankMovement.updateMany({
          where: { id: { in: ids } },
          data: { status: "sin_asignar" },
        }),
      ]);

      // Para cada factura afectada: si era un "pago sin respaldo" y quedó
      // sin imputaciones, se borra (es un registro auto-creado, huérfano
      // sin el movimiento). El resto solo recalcula status.
      for (const invId of affectedInvoiceIds) {
        const inv = await prisma.invoice.findUnique({
          where: { id: invId },
          include: { payments: { select: { id: true } } },
        });
        if (!inv) continue;
        if (inv.origin === "sin_respaldo" && inv.payments.length === 0) {
          await prisma.invoice.delete({ where: { id: invId } });
        } else {
          await recomputeInvoiceStatus(invId);
        }
      }

      return NextResponse.json({ ok: true, desasignados: ids.length });
    }

    // ── PAGO SIN FACTURA (registro de costo sin respaldo) ──────────────
    if (action === "pago_sin_factura") {
      const { projectId, categoryId } = body;
      if (!projectId || !categoryId) {
        return NextResponse.json(
          { error: "Falta el proyecto o la categoría" },
          { status: 400 }
        );
      }
      const [project, category] = await Promise.all([
        prisma.project.findUnique({
          where: { id: projectId },
          select: { id: true },
        }),
        prisma.costCategory.findUnique({
          where: { id: categoryId },
          select: { id: true },
        }),
      ]);
      if (!project) {
        return NextResponse.json(
          { error: "El proyecto no existe" },
          { status: 404 }
        );
      }
      if (!category) {
        return NextResponse.json(
          { error: "La categoría no existe" },
          { status: 404 }
        );
      }

      // Procesables: egresos (amount < 0) que todavía no tienen imputación.
      // Los que ya tienen pago o son ingresos se omiten y se reportan.
      const procesables = targetMovs.filter(
        (m) => m.amount < 0 && m.payments.length === 0
      );
      const omitidos = targetMovs.length - procesables.length;

      if (procesables.length === 0) {
        return NextResponse.json(
          {
            error:
              "Ningún movimiento es procesable (ya tienen imputación o no son egresos).",
          },
          { status: 400 }
        );
      }

      await prisma.$transaction(async (tx) => {
        for (const m of procesables) {
          const monto = Math.abs(m.amount);
          // folioNumber tiene que ser único dentro de (type, tipoDoc,
          // rutIssuer). Lo derivamos del movimiento, que es único.
          const folio = `SR-${m.externalRef || m.id}`;
          const inv = await tx.invoice.create({
            data: {
              projectId,
              categoryId,
              type: "recibida",
              tipoDoc: 1043, // código interno: pago sin documento tributario
              folioNumber: folio,
              rutIssuer: m.counterpartyRut,
              rutReceiver: BLARQ_RUT,
              businessName: m.counterpartyName,
              issueDate: m.date,
              dueDate: m.date,
              netAmount: monto,
              iva: 0,
              totalAmount: monto,
              status: "pagada",
              paidAt: m.date,
              origin: "sin_respaldo",
              notes:
                "Pago sin documento tributario. Creado desde el movimiento bancario.",
            },
          });
          await tx.invoicePayment.create({
            data: {
              bankMovementId: m.id,
              invoiceId: inv.id,
              amountApplied: monto,
            },
          });
          await tx.bankMovement.update({
            where: { id: m.id },
            data: { status: "conciliado", category: null },
          });
        }
      });

      return NextResponse.json({
        ok: true,
        creados: procesables.length,
        omitidos,
      });
    }

    // ── ASIGNAR A FACTURA ──────────────────────────────────────────────
    const invoiceId = body.invoiceId;
    if (!invoiceId) {
      return NextResponse.json({ error: "Falta la factura destino" }, { status: 400 });
    }
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        folioNumber: true,
        totalAmount: true,
        // Pagos actuales de la factura — para calcular cuánto saldo le
        // queda antes de aceptar este lote.
        payments: { select: { amountApplied: true, bankMovementId: true } },
      },
    });
    if (!invoice) {
      return NextResponse.json({ error: "La factura no existe" }, { status: 404 });
    }

    const ids = targetMovs.map((m) => m.id);

    // TOPE anti-sobre-imputación. Este camino imputa cada movimiento por su
    // monto COMPLETO; sin tope, marcar varios movimientos contra una factura
    // chica la dejaba con más cobrado que su total (sobre-imputada) y
    // "enterraba" plata que en realidad era de otra factura. La plata de los
    // proyectos no se descuadra (sale de las facturas, no de los enganches),
    // pero la trazabilidad sí. Acá cortamos antes de hacer el daño.
    //
    // Capacidad = total de la factura − pagos que NO vienen de este lote
    // (los de este lote se reemplazan, así que no cuentan). Si el lote supera
    // esa capacidad, no asignamos nada y le explicamos a MJ por cuánto se pasa.
    const batchSum = targetMovs.reduce((s, m) => s + Math.abs(m.amount), 0);
    const idSet = new Set(ids);
    const otherPaid = invoice.payments
      .filter((p) => !p.bankMovementId || !idSet.has(p.bankMovementId))
      .reduce((s, p) => s + p.amountApplied, 0);
    const capacity = invoice.totalAmount - otherPaid;
    if (batchSum > capacity + 1) {
      const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
      const exceso = batchSum - Math.max(0, capacity);
      return NextResponse.json(
        {
          error:
            `Estos ${targetMovs.length} movimiento${targetMovs.length !== 1 ? "s" : ""} suman ${clp(batchSum)}, ` +
            `pero a la factura F-${invoice.folioNumber ?? "?"} solo le queda saldo ${clp(Math.max(0, capacity))} ` +
            `(se pasa ${clp(exceso)}). Revisá la selección, o usá "Asignar" en la fila ` +
            `para repartir el monto entre varias facturas.`,
        },
        { status: 400 }
      );
    }

    // Imputaciones previas que se reemplazan — esas facturas también
    // recalculan status (pueden quedar con menos cobrado que antes).
    const previousInvoiceIds = targetMovs.flatMap((m) =>
      m.payments.map((p) => p.invoiceId)
    );
    const affectedInvoiceIds = Array.from(
      new Set([invoiceId, ...previousInvoiceIds])
    );

    await prisma.$transaction([
      // Replace: borrar lo que tuvieran y crear un pago por mov.
      prisma.invoicePayment.deleteMany({ where: { bankMovementId: { in: ids } } }),
      ...targetMovs.map((m) =>
        prisma.invoicePayment.create({
          data: {
            bankMovementId: m.id,
            invoiceId,
            amountApplied: Math.abs(m.amount),
          },
        })
      ),
      // Mov totalmente imputado a una factura → conciliado. Se limpia la
      // categoría (la factura tiene la suya).
      prisma.bankMovement.updateMany({
        where: { id: { in: ids } },
        data: { status: "conciliado", category: null },
      }),
    ]);

    for (const invId of affectedInvoiceIds) {
      await recomputeInvoiceStatus(invId);
    }

    return NextResponse.json({ ok: true, asignados: ids.length });
  } catch (error) {
    console.error("Error bulk movimientos:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error" },
      { status: 500 }
    );
  }
}
