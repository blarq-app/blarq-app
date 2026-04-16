import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
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

    return NextResponse.json(invoice);
  } catch (error) {
    console.error("Error creating invoice:", error);
    return NextResponse.json(
      { error: "Error al crear factura" },
      { status: 500 }
    );
  }
}
