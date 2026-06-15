import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { tryAutoMatchInvoiceWithExistingMovs } from "@/lib/banco/invoicePayments";
import { applyInvoiceRule } from "@/lib/facturas/categorizationRules";
import { requireSession } from "@/lib/apiAuth";

// Listar facturas con filtros opcionales:
//   ?type=emitida|recibida
//   ?status=pendiente|pagada|anulada
//   ?origin=manual|sii_automatica
//   ?projectId=<id>|sin-asignar
//   ?categoryId=<id>
//   ?q=<texto> (busca en folioNumber, businessName, rutIssuer, notes)
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const status = searchParams.get("status");
  const origin = searchParams.get("origin");
  const projectId = searchParams.get("projectId");
  const categoryId = searchParams.get("categoryId");
  const q = searchParams.get("q");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: Record<string, unknown> = {};
  if (type) where.type = type;
  if (status) where.status = status;
  if (origin) where.origin = origin;
  if (categoryId) where.categoryId = categoryId;
  if (projectId === "sin-asignar") where.projectId = null;
  else if (projectId) where.projectId = projectId;
  if (from || to) {
    where.issueDate = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }
  if (q) {
    where.OR = [
      { folioNumber: { contains: q, mode: "insensitive" } },
      { businessName: { contains: q, mode: "insensitive" } },
      { rutIssuer: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
    ];
  }

  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: { issueDate: "desc" },
    include: {
      project: { select: { id: true, name: true } },
      category: {
        select: {
          id: true,
          name: true,
          parent: { select: { id: true, name: true } },
        },
      },
    },
    take: 500,
  });
  return NextResponse.json(invoices);
}

export async function POST(request: NextRequest) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const data = await request.json();

    if (!data.type) {
      return NextResponse.json(
        { error: "Tipo de factura requerido" },
        { status: 400 }
      );
    }

    const netAmount = data.netAmount || 0;
    const iva = netAmount * 0.19;
    const totalAmount = netAmount + iva;

    const invoice = await prisma.invoice.create({
      data: {
        projectId: data.projectId || null,
        categoryId: data.categoryId || null,
        type: data.type,
        folioNumber: data.folioNumber || null,
        rutIssuer: data.rutIssuer || null,
        businessName: data.businessName || null,
        issueDate: new Date(data.issueDate || Date.now()),
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        netAmount,
        iva,
        totalAmount,
        status: data.status || "pendiente",
        origin: "manual",
        notes: data.notes || null,
      },
    });

    // Aplicar regla por RUT si existe (solo recibidas con categoría vacía).
    const ruleApplied = await applyInvoiceRule(invoice.id).catch(() => ({
      applied: false,
    }));
    // Auto-conciliar si hay un movimiento bancario sin asignar del mismo
    // RUT que matchea el monto. Caso típico MJ: te pagaron antes, ahora
    // emitís factura → se vincula sola sin tocar nada.
    const autoMatched = await tryAutoMatchInvoiceWithExistingMovs(invoice.id).catch(
      () => 0
    );

    return NextResponse.json({ ...invoice, autoMatched, ruleApplied });
  } catch (error) {
    console.error("Error creating invoice:", error);
    return NextResponse.json(
      { error: "Error al crear factura" },
      { status: 500 }
    );
  }
}
