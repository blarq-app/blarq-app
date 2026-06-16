import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { upsertInvoiceRule } from "@/lib/facturas/categorizationRules";
import { requireSession } from "@/lib/apiAuth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

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
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

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

    // Si la factura tiene categoría asignada, asegurar que exista una
    // regla por RUT y aplicarla retroactivamente a las demás facturas del
    // mismo proveedor sin categoría.
    //
    // IMPORTANTE: desde acá nunca se guarda PROYECTO como regla. La mayoría
    // de los proveedores son transversales a varias obras (Easy/Sodimac/MK),
    // y guardar proyecto como regla arrastra retroactivamente facturas a
    // proyectos equivocados. Para los proveedores que sí van siempre al
    // mismo proyecto (Autopistas/Bencina = BLARQ), MJ lo hace explícito
    // desde el bulk-assign con el toggle "Guardar centro de costo en regla".
    let rule:
      | {
          ruleId: string;
          created: boolean;
          updated: boolean;
          appliedRetroactively: number;
        }
      | null = null;
    if (invoice.rutIssuer && invoice.categoryId) {
      const r = await upsertInvoiceRule(
        invoice.rutIssuer,
        invoice.businessName ?? null,
        { categoryId: invoice.categoryId }
      ).catch(() => null);
      if (r && (r.created || r.updated || r.appliedRetroactively > 0)) rule = r;
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
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    const data = await request.json();

    const updates: Record<string, unknown> = {};
    if ("categoryId" in data) updates.categoryId = data.categoryId || null;
    if ("projectId" in data) updates.projectId = data.projectId || null;
    // conceptoCobro: solo aplica a facturas EMITIDAS (obra | muebles |
    // artefactos | mixto). Define a qué "centro" del proyecto entra el cobro,
    // y con eso cuánta utilidad se reconoce para Sueldos (ver utilidadPorCobro).
    if ("conceptoCobro" in data) updates.conceptoCobro = data.conceptoCobro || null;
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

    // Edición inline: solo se aprende CATEGORÍA como regla, nunca proyecto.
    // El proyecto desde inline es siempre puntual — para crear regla de
    // "proveedor X siempre a obra Y" hay que ir al bulk-assign y prender
    // el toggle "Guardar centro de costo en regla".
    let rule:
      | {
          ruleId: string;
          created: boolean;
          updated: boolean;
          appliedRetroactively: number;
        }
      | null = null;
    if (
      invoice.rutIssuer &&
      "categoryId" in updates &&
      invoice.categoryId
    ) {
      const r = await upsertInvoiceRule(
        invoice.rutIssuer,
        invoice.businessName ?? null,
        { categoryId: invoice.categoryId }
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
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

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
