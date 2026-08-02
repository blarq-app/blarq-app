import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/apiAuth";
import { MOV_STATUS, statusPorImputacion } from "@/lib/banco/movementStatus";

// Reembolso de boletas: un egreso del banco = VARIAS boletas.
//
//   POST /api/banco/movimientos/[id]/reembolso-boletas
//   { boletas: [{ numeroDoc, fecha, comercio, monto, projectId, categoryId, foto }] }
//
// Caso real: MJ le transfiere $63.773 a Daniel Ignacio, que pagó de su bolsillo
// tres boletas de obras distintas. Hasta ahora eso solo se podía registrar como
// UN gasto — se perdía a qué obra iba cada boleta y no había respaldo por
// documento. Acá cada boleta queda como su propio gasto (Invoice 1043) con su
// foto, su obra y su categoría, y las tres se cuelgan del MISMO movimiento
// bancario.
//
// Sobre la plata: no se inventa nada. La suma de las boletas nunca puede pasar
// el saldo libre del movimiento (tope anti-sobre-imputación). Si suma MENOS, se
// permite a propósito — MJ pidió poder cargar lo que tenga y volver después; el
// movimiento queda "parcial" con el saldo pendiente a la vista.
//
// "Quién pagó" no se guarda: se deriva de la contraparte del movimiento al
// mostrarlo (ver src/lib/contabilidad/gastosMes.ts).

const BLARQ_RUT = "77.270.733-9";

interface BoletaEntrada {
  numeroDoc?: string | null;
  fecha?: string | null; // YYYY-MM-DD
  comercio?: string | null;
  monto?: number;
  projectId?: string | null;
  categoryId?: string | null;
  foto?: string | null; // data URL comprimido en el navegador
  tipo?: "boleta" | "internacional";
}

// Los montos vienen del navegador: se aceptan solo enteros positivos en pesos.
function montoValido(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 && n < 1e12;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const boletas: BoletaEntrada[] = Array.isArray(body?.boletas) ? body.boletas : [];

  if (boletas.length === 0) {
    return NextResponse.json(
      { error: "No hay boletas para registrar" },
      { status: 400 }
    );
  }
  if (boletas.length > 50) {
    return NextResponse.json(
      { error: "Demasiadas boletas en un solo reembolso (máximo 50)" },
      { status: 400 }
    );
  }

  const mov = await prisma.bankMovement.findUnique({
    where: { id },
    select: {
      id: true,
      amount: true,
      date: true,
      counterpartyName: true,
      payments: { select: { amountApplied: true } },
    },
  });
  if (!mov) {
    return NextResponse.json({ error: "El movimiento no existe" }, { status: 404 });
  }
  if (mov.amount >= 0) {
    return NextResponse.json(
      { error: "Solo se pueden registrar boletas sobre un egreso (un cargo)" },
      { status: 400 }
    );
  }

  // Validación de cada boleta antes de tocar la base.
  for (const [i, b] of boletas.entries()) {
    if (!montoValido(b.monto)) {
      return NextResponse.json(
        { error: `La boleta ${i + 1} no tiene un monto válido` },
        { status: 400 }
      );
    }
    if (b.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(b.fecha)) {
      return NextResponse.json(
        { error: `La boleta ${i + 1} tiene una fecha con formato raro` },
        { status: 400 }
      );
    }
  }

  // Tope: lo que ya está imputado + lo nuevo no puede pasar el monto del
  // movimiento. Sin esto se podría "gastar" el mismo egreso dos veces.
  const yaImputado = mov.payments.reduce((s, p) => s + p.amountApplied, 0);
  const totalMovimiento = Math.abs(mov.amount);
  const suma = boletas.reduce((s, b) => s + (b.monto ?? 0), 0);
  const libre = totalMovimiento - yaImputado;
  // Un peso de tolerancia por los redondeos de la cartola.
  if (suma > libre + 1) {
    return NextResponse.json(
      {
        error: `Las boletas suman $${suma.toLocaleString("es-CL")} y el movimiento solo tiene $${libre.toLocaleString("es-CL")} sin imputar.`,
      },
      { status: 400 }
    );
  }

  // Los proyectos y categorías se validan de una sola vez.
  const projectIds = [...new Set(boletas.map((b) => b.projectId).filter(Boolean))] as string[];
  const categoryIds = [...new Set(boletas.map((b) => b.categoryId).filter(Boolean))] as string[];
  const [proyectos, categorias] = await Promise.all([
    projectIds.length
      ? prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true } })
      : Promise.resolve([]),
    categoryIds.length
      ? prisma.costCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true } })
      : Promise.resolve([]),
  ]);
  if (proyectos.length !== projectIds.length) {
    return NextResponse.json({ error: "Alguna obra no existe" }, { status: 404 });
  }
  if (categorias.length !== categoryIds.length) {
    return NextResponse.json({ error: "Alguna categoría no existe" }, { status: 404 });
  }

  const creadas = await prisma.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const b of boletas) {
      const monto = b.monto as number;
      const esInternacional = b.tipo === "internacional";
      // Fecha de la boleta si se pudo leer; si no, la del movimiento (es lo
      // más cercano que tenemos y mantiene el gasto en el mes correcto).
      const fecha = b.fecha ? new Date(`${b.fecha}T12:00:00`) : mov.date;
      // El folio guarda el número IMPRESO en la boleta cuando existe — es lo
      // que se muestra en el respaldo del F22. Si no se leyó, se usa uno
      // interno con prefijo (el PDF los esconde). No colisiona con otras
      // boletas del mismo número porque rutIssuer queda null y Postgres trata
      // los NULL como distintos en el índice único.
      const prefijo = esInternacional ? "INT" : "BOL";
      const folio =
        b.numeroDoc?.trim() || `${prefijo}-${mov.id.slice(-8)}-${ids.length + 1}`;

      const inv = await tx.invoice.create({
        data: {
          projectId: b.projectId ?? null,
          categoryId: b.categoryId ?? null,
          type: "recibida",
          // 1043 = gasto sin documento tributario del SII → fuera del F29 y de
          // la vista Facturación, pero cuenta como costo de la obra.
          tipoDoc: 1043,
          folioNumber: folio,
          rutIssuer: null,
          rutReceiver: BLARQ_RUT,
          businessName: b.comercio?.trim() || null,
          issueDate: fecha,
          dueDate: fecha,
          // Sin IVA recuperable: el costo real es el total pagado.
          netAmount: monto,
          iva: 0,
          totalAmount: monto,
          status: "pagada",
          paidAt: mov.date,
          origin: esInternacional ? "gasto_internacional" : "gasto_boleta",
          attachmentUrl: b.foto ?? null,
          notes: `${esInternacional ? "Gasto internacional" : "Boleta"} reembolsada a ${mov.counterpartyName ?? "un tercero"}.`,
        },
        select: { id: true },
      });
      await tx.invoicePayment.create({
        data: { bankMovementId: mov.id, invoiceId: inv.id, amountApplied: monto },
      });
      ids.push(inv.id);
    }

    // Estado del movimiento derivado por la fuente única (movementStatus.ts):
    // conciliado si quedó todo imputado, parcial si sobra saldo. Acá siempre
    // hay al menos una boleta imputada, así que nunca cae al fallback.
    const totalImputado = yaImputado + suma;
    await tx.bankMovement.update({
      where: { id: mov.id },
      data: {
        status:
          statusPorImputacion(totalImputado, totalMovimiento) ??
          MOV_STATUS.SIN_ASIGNAR,
        // La categoría del movimiento se limpia: ahora cada boleta tiene la suya.
        category: null,
      },
    });
    return ids;
    // Cada boleta son dos escrituras (el gasto y su imputación) y las fotos van
    // adentro del registro: con varias boletas la transacción se pasa del tope
    // de 5 segundos que trae Prisma por default y se caía entera.
  }, { timeout: 30_000 });

  const pendiente = Math.max(0, totalMovimiento - yaImputado - suma);
  return NextResponse.json({
    ok: true,
    creadas: creadas.length,
    total: suma,
    pendiente,
  });
}
