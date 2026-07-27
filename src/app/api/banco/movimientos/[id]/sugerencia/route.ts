import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/apiAuth";
import { proposeMovementInvoiceMatch } from "@/lib/banco/invoicePayments";

// GET /api/banco/movimientos/[id]/sugerencia
//
// Lo que la app opina sobre ESTE movimiento, sin escribir nada. Es la misma
// propuesta que arma el masivo "Conciliar pendientes", pedida de a uno para
// pintarla arriba del modal de conciliar.
//
// Por qué existe: hasta ahora el modal armaba su propia sugerencia en el
// cliente, mirando solo el monto (±$10) de los resultados que ya tenía a mano.
// Eso daba una segunda opinión más floja que la del motor: el masivo podía
// dejar un movimiento pendiente por desconfiar del RUT y el modal, para ese
// mismo movimiento, mostrar un cartel verde que se veía seguro. Ahora los dos
// preguntan lo mismo al mismo lugar, y cuando el motor duda la respuesta
// viene rotulada "probable" CON el motivo de la duda.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const { id } = await params;

  const mov = await prisma.bankMovement.findUnique({
    where: { id },
    select: {
      id: true,
      amount: true,
      status: true,
      description: true,
      counterpartyRut: true,
      counterpartyName: true,
      date: true,
      category: true,
      payments: { select: { id: true } },
    },
  });
  if (!mov) {
    return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 });
  }

  const propuesta = await proposeMovementInvoiceMatch(mov);

  // Si hay factura propuesta, la devolvemos con lo justo para pintarla sin
  // que el modal tenga que ir a buscarla de nuevo.
  if (!propuesta.invoiceId) {
    return NextResponse.json({ ...propuesta, factura: null });
  }

  const inv = await prisma.invoice.findUnique({
    where: { id: propuesta.invoiceId },
    select: {
      id: true,
      folioNumber: true,
      businessName: true,
      rutIssuer: true,
      totalAmount: true,
      issueDate: true,
      status: true,
      payments: { select: { amountApplied: true } },
      project: { select: { name: true } },
    },
  });
  if (!inv) return NextResponse.json({ ...propuesta, factura: null });

  const pagado = inv.payments.reduce((s, p) => s + p.amountApplied, 0);

  return NextResponse.json({
    ...propuesta,
    factura: {
      id: inv.id,
      folioNumber: inv.folioNumber,
      businessName: inv.businessName,
      rutIssuer: inv.rutIssuer,
      totalAmount: inv.totalAmount,
      remaining: inv.totalAmount - pagado,
      issueDate: inv.issueDate.toISOString(),
      status: inv.status,
      projectName: inv.project?.name ?? null,
    },
  });
}
