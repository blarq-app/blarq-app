import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
    },
  });
  if (!invoice) {
    return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
  }
  return NextResponse.json(invoice);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await request.json();

    const netAmount = data.netAmount || 0;
    const iva = netAmount * 0.19;
    const totalAmount = netAmount + iva;

    const invoice = await prisma.invoice.update({
      where: { id },
      data: {
        projectId: data.projectId || null,
        categoryId: data.categoryId || null,
        folioNumber: data.folioNumber,
        rutIssuer: data.rutIssuer,
        businessName: data.businessName,
        issueDate: data.issueDate ? new Date(data.issueDate) : undefined,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        netAmount,
        iva,
        totalAmount,
        status: data.status,
        notes: data.notes,
      },
    });

    return NextResponse.json(invoice);
  } catch (error) {
    console.error("Error updating invoice:", error);
    return NextResponse.json(
      { error: "Error al actualizar factura" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.invoice.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting invoice:", error);
    return NextResponse.json(
      { error: "Error al eliminar factura" },
      { status: 500 }
    );
  }
}
