import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { upsertInvoiceRule } from "@/lib/facturas/categorizationRules";

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

    // Estado previo (para detectar si la categoría cambió).
    const previous = await prisma.invoice.findUnique({
      where: { id },
      select: { type: true, categoryId: true, rutIssuer: true, businessName: true },
    });

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
        // Solo aceptamos cuando vienen — undefined = no tocar.
        ...(data.referenceFolioNumber !== undefined && {
          referenceFolioNumber: data.referenceFolioNumber || null,
        }),
        ...(data.referenceTipoDoc !== undefined && {
          referenceTipoDoc: data.referenceTipoDoc ?? null,
        }),
      },
    });

    // Si MJ guardó una factura RECIBIDA con categoría asignada, asegurar
    // que exista una regla por RUT y aplicarla retroactivamente a las
    // demás facturas del mismo proveedor sin categoría. No exigimos que
    // "haya cambiado" — si la categoría coincide con la regla existente,
    // upsertInvoiceRule solo incrementa hits + dispara la retroactividad
    // (que es lo que MJ esperaba: "si le enseño a 1, contagia a los otros").
    let rule:
      | {
          ruleId: string;
          created: boolean;
          updated: boolean;
          appliedRetroactively: number;
          previousCategoryId?: string | null;
        }
      | null = null;
    if (invoice.type === "recibida" && invoice.categoryId && invoice.rutIssuer) {
      const r = await upsertInvoiceRule(
        invoice.rutIssuer,
        invoice.businessName ?? null,
        invoice.categoryId
      ).catch(() => null);
      // Solo emitimos rule en la respuesta si pasó algo digno de toast:
      // creó la regla, la cambió, o aplicó retroactivamente.
      if (
        r &&
        (r.created || r.updated || r.appliedRetroactively > 0)
      ) {
        rule = r;
      }
    }

    return NextResponse.json({ ...invoice, rule });
  } catch (error) {
    console.error("Error updating invoice:", error);
    return NextResponse.json(
      { error: "Error al actualizar factura" },
      { status: 500 }
    );
  }
}

// PATCH — edición parcial. A diferencia de PUT (formulario completo del
// detalle), acepta solo categoryId y/o projectId y NO toca montos/fechas.
// Pensado para edición inline desde la lista del proyecto.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await request.json();

    const updates: Record<string, unknown> = {};
    if ("categoryId" in data) updates.categoryId = data.categoryId || null;
    if ("projectId" in data) updates.projectId = data.projectId || null;
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
    }

    const invoice = await prisma.invoice.update({
      where: { id },
      data: updates,
      select: {
        id: true,
        type: true,
        categoryId: true,
        projectId: true,
        rutIssuer: true,
        businessName: true,
      },
    });

    // Si MJ asignó categoría a una recibida, reusar el motor de reglas
    // (mismo comportamiento que PUT) — propaga retroactivamente al RUT.
    let rule:
      | {
          ruleId: string;
          created: boolean;
          updated: boolean;
          appliedRetroactively: number;
          previousCategoryId?: string | null;
        }
      | null = null;
    if (
      "categoryId" in updates &&
      invoice.type === "recibida" &&
      invoice.categoryId &&
      invoice.rutIssuer
    ) {
      const r = await upsertInvoiceRule(
        invoice.rutIssuer,
        invoice.businessName ?? null,
        invoice.categoryId
      ).catch(() => null);
      if (r && (r.created || r.updated || r.appliedRetroactively > 0)) rule = r;
    }

    return NextResponse.json({ ...invoice, rule });
  } catch (error) {
    console.error("Error patching invoice:", error);
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
