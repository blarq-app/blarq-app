import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { recomputeInvoiceStatus, cleanupInvoicesAfterUnassign } from "@/lib/banco/invoicePayments";
import {
  MOV_STATUS,
  recomputeMovementsStatus,
  recomputeMovementStatus,
  saldadoDelMovimiento,
} from "@/lib/banco/movementStatus";
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
//   { action: "registrar_gasto", movementIds: [], projectId, categoryId,
//     tipoGasto: "boleta" | "internacional" }
//      → captura gastos reales que NO llegan como factura del SII: compras
//        con BOLETA (no dan crédito de IVA) y GASTOS INTERNACIONALES
//        (suscripciones tipo Claude/Google, sin IVA chileno). Por cada
//        egreso crea un Invoice type=recibida, tipoDoc=1043 (gasto sin
//        documento tributario → fuera del F29 / vista Facturación, igual
//        que los pagos a maestros), iva=0 y netAmount = total pagado (no
//        hay IVA que recuperar, así que el costo es el bruto). Se distingue
//        del pago a maestro por el origin (gasto_boleta / gasto_internacional)
//        para poder separarlos después (ej. gastos de empresa del F22).
//        Siempre queda pagado y conciliado contra el movimiento — la gracia
//        de registrarlo acá es conciliar el cargo que no tiene factura.
//
// No toca movimientos "interno".
export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const body = (await request.json()) as Partial<{
      action:
        | "desasignar"
        | "asignar"
        | "pago_sin_factura"
        | "registrar_gasto"
        | "neto_cero";
      movementIds: string[];
      invoiceId: string;
      projectId: string;
      categoryId: string;
      // Solo para "registrar_gasto":
      tipoGasto: "boleta" | "internacional";
    }>;

    const action = body.action;
    const movementIds = body.movementIds ?? [];
    if (
      action !== "desasignar" &&
      action !== "asignar" &&
      action !== "pago_sin_factura" &&
      action !== "registrar_gasto" &&
      action !== "neto_cero"
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

    // ── DEVOLUCIÓN NETO CERO ───────────────────────────────────────────
    // Plata que salió y volvió. Dos formas del mismo gesto:
    //
    //   ENTERA — un pago por error que volvió completo (la clienta transfirió
    //   de más y se le devolvió). Los dos movimientos se cancelan enteros.
    //
    //   SOLO EL SOBRANTE — le pagaste de más a un proveedor y te devolvió la
    //   diferencia. El pago grande YA está conciliado a su factura, y eso está
    //   bien: la factura se pagó por lo que corresponde. Lo único que se netea
    //   es lo que sobraba. Hasta 2026-08-17 este caso no se podía cerrar — la
    //   acción exigía que ningún movimiento tuviera factura pegada, así que el
    //   sobrante y su devolución quedaban pendientes para siempre (era el
    //   "Caso C" sin resolver del ADR de plata que no es gasto ni ingreso).
    //
    // La cuenta se hace siempre sobre la PARTE LIBRE de cada movimiento (lo que
    // no explica ninguna factura ni un neteo anterior), con el signo del
    // movimiento. El caso entero es el mismo cálculo cuando no hay facturas.
    if (action === "neto_cero") {
      const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
      if (movs.length < 2) {
        return NextResponse.json(
          { error: "Elegí al menos 2 movimientos: las entradas y las salidas que se cancelan." },
          { status: 400 }
        );
      }
      if (movs.some((m) => m.status === "interno" || m.status === "neto_cero")) {
        return NextResponse.json(
          { error: "Algún movimiento ya es interno o neto cero. Sacalo de la selección." },
          { status: 400 }
        );
      }

      // Parte libre de cada movimiento, con signo: negativa si salió plata,
      // positiva si entró. Descuenta lo ya imputado a facturas y lo ya neteado
      // por un grupo anterior.
      const libres = await Promise.all(
        movs.map(async (m) => {
          const saldado = await saldadoDelMovimiento(m.id);
          const libre = Math.abs(m.amount) - saldado;
          return { mov: m, libre, conSigno: Math.sign(m.amount) * libre };
        })
      );

      const sinNadaLibre = libres.filter((l) => l.libre <= 1);
      if (sinNadaLibre.length > 0) {
        return NextResponse.json(
          {
            error:
              `${sinNadaLibre.length === 1 ? "Un movimiento de la selección ya está" : `${sinNadaLibre.length} movimientos de la selección ya están`} ` +
              `explicado${sinNadaLibre.length === 1 ? "" : "s"} entero${sinNadaLibre.length === 1 ? "" : "s"}: no le${sinNadaLibre.length === 1 ? "" : "s"} sobra nada para netear. Sacalo${sinNadaLibre.length === 1 ? "" : "s"} de la selección.`,
          },
          { status: 400 }
        );
      }
      if (!libres.some((l) => l.conSigno > 0) || !libres.some((l) => l.conSigno < 0)) {
        return NextResponse.json(
          { error: "Una devolución neto cero necesita al menos una entrada y una salida." },
          { status: 400 }
        );
      }
      const suma = libres.reduce((s, l) => s + l.conSigno, 0);
      if (Math.abs(suma) > 10) {
        return NextResponse.json(
          {
            error:
              `Lo que queda libre no se cancela: sobra un neto de ${clp(suma)}. ` +
              `Revisá la selección (¿falta o sobra algún movimiento?).`,
          },
          { status: 400 }
        );
      }

      // Id de grupo que linkea los movimientos de este lavado.
      const groupId = crypto.randomUUID();
      for (const { mov, libre } of libres) {
        // Lo neteado se ACUMULA: un movimiento puede tener dos sobrantes
        // devueltos en momentos distintos.
        const neteado = (mov.netZeroAmount ?? 0) + libre;
        await prisma.bankMovement.update({
          where: { id: mov.id },
          data: { netZeroGroupId: groupId, netZeroAmount: neteado, category: null },
        });
        if (mov.payments.length === 0) {
          // Movimiento entero neteado: es una devolución pura y se rotula como
          // tal (modo explícito, el recompute no lo pisa).
          await prisma.bankMovement.update({
            where: { id: mov.id },
            data: { status: MOV_STATUS.NETO_CERO },
          });
        } else {
          // Tiene factura pegada: el status lo deriva la plata explicada, que
          // ahora incluye lo neteado → sale de "parcial" y queda conciliado.
          await recomputeMovementStatus(mov.id);
        }
      }
      return NextResponse.json({ ok: true, neteados: movs.length });
    }

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

      await prisma.invoicePayment.deleteMany({
        where: { bankMovementId: { in: ids } },
      });
      // Recompute (no un updateMany a mano): los que tenían pagos vuelven a
      // sin_asignar; uno sin_factura que cayó en la selección se queda
      // sin_factura (quitarle la categoría es otra acción, no esta).
      await recomputeMovementsStatus(ids);

      // Para cada factura afectada: si era un "pago sin respaldo" y quedó sin
      // imputaciones, se borra (registro auto-creado, huérfano sin el
      // movimiento); el resto solo recalcula status. Lógica compartida con el
      // PATCH individual ("Editar") — ver cleanupInvoicesAfterUnassign.
      await cleanupInvoicesAfterUnassign(affectedInvoiceIds);

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
            // Pago recién creado por el monto completo del mov → conciliado.
            // (La categoría se limpia: la factura tiene la suya.)
            data: { status: MOV_STATUS.CONCILIADO, category: null },
          });
        }
      });

      return NextResponse.json({
        ok: true,
        creados: procesables.length,
        omitidos,
      });
    }

    // ── REGISTRAR GASTO (boleta / internacional, sin documento del SII) ──
    if (action === "registrar_gasto") {
      const { projectId, categoryId, tipoGasto } = body;
      if (tipoGasto !== "boleta" && tipoGasto !== "internacional") {
        return NextResponse.json(
          { error: "Tipo de gasto inválido (boleta | internacional)" },
          { status: 400 }
        );
      }
      // Obra y categoría son OPCIONALES: el gasto se puede crear "sin asignar"
      // (ej. un click en el banco marcando Google como internacional) y se
      // cataloga después en Contabilidad → Gastos, con el mismo criterio que
      // las facturas (obra/categoría viven en el documento). Si vienen, se
      // validan; si no, quedan null.
      const [project, category] = await Promise.all([
        projectId
          ? prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
          : Promise.resolve(null),
        categoryId
          ? prisma.costCategory.findUnique({ where: { id: categoryId }, select: { id: true } })
          : Promise.resolve(null),
      ]);
      if (projectId && !project) {
        return NextResponse.json(
          { error: "El proyecto no existe" },
          { status: 404 }
        );
      }
      if (categoryId && !category) {
        return NextResponse.json(
          { error: "La categoría no existe" },
          { status: 404 }
        );
      }

      // Procesables: egresos (amount < 0) sin imputación previa.
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

      // origin distingue el tipo de gasto para poder separarlos después
      // (ej. gastos de empresa del F22). El prefijo del folio los hace únicos
      // dentro de (type, tipoDoc, rutIssuer) y legibles en la lista.
      const origin =
        tipoGasto === "boleta" ? "gasto_boleta" : "gasto_internacional";
      const prefijo = tipoGasto === "boleta" ? "BOL" : "INT";
      const etiqueta =
        tipoGasto === "boleta" ? "Boleta" : "Gasto internacional";

      await prisma.$transaction(async (tx) => {
        for (const m of procesables) {
          const monto = Math.abs(m.amount);
          const folio = `${prefijo}-${m.externalRef || m.id}`;
          const inv = await tx.invoice.create({
            data: {
              projectId: projectId ?? null,
              categoryId: categoryId ?? null,
              type: "recibida",
              // 1043 = gasto sin documento tributario del SII → fuera del F29
              // y de la vista Facturación (igual que el pago a maestro).
              tipoDoc: 1043,
              folioNumber: folio,
              rutIssuer: m.counterpartyRut,
              rutReceiver: BLARQ_RUT,
              businessName: m.counterpartyName,
              issueDate: m.date,
              dueDate: m.date,
              // Sin IVA recuperable: el costo real es el total pagado.
              netAmount: monto,
              iva: 0,
              totalAmount: monto,
              status: "pagada",
              paidAt: m.date,
              origin,
              notes: `${etiqueta}. Registrado desde el movimiento bancario.`,
            },
          });
          // La gracia de registrarlo desde el banco es conciliar el cargo
          // que no tiene factura: siempre queda pegado al movimiento.
          await tx.invoicePayment.create({
            data: {
              bankMovementId: m.id,
              invoiceId: inv.id,
              amountApplied: monto,
            },
          });
          await tx.bankMovement.update({
            where: { id: m.id },
            // Pago recién creado por el monto completo del mov → conciliado.
            // (La categoría se limpia: la factura tiene la suya.)
            data: { status: MOV_STATUS.CONCILIADO, category: null },
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
        data: { status: MOV_STATUS.CONCILIADO, category: null },
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
