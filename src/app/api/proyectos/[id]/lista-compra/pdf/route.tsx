import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import {
  renderListaCompraHTML,
  buildListaCompraFooter,
  type ListaCompraRow,
} from "@/lib/pdf/ListaCompraPDF.html";
import { renderPDF } from "@/lib/pdf/renderPDF";
import { requireSession } from "@/lib/apiAuth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const v = searchParams.get("v") || "";
    const filter = (searchParams.get("filter") || "pendiente") as
      | "todo"
      | "pendiente"
      | "comprado";

    const project = await prisma.project.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
    }

    // Presupuesto seleccionado
    const obraBudgets = await prisma.budgetVersion.findMany({
      where: { projectId: id, type: "obra" },
      orderBy: { createdAt: "desc" },
      select: { id: true, version: true, status: true },
    });

    let selectedBudget = v ? obraBudgets.find((b) => b.id === v) : null;
    if (!selectedBudget)
      selectedBudget = obraBudgets.find((b) => b.status === "aprobado") || null;
    if (!selectedBudget) selectedBudget = obraBudgets[0] || null;

    let rows: ListaCompraRow[] = [];

    if (selectedBudget) {
      // Lee snapshot del proyecto (ObraItemComponent), no catálogo.
      // Regla MJ 2026-05-05.
      const full = await prisma.budgetVersion.findUnique({
        where: { id: selectedBudget.id },
        include: {
          obraItems: {
            include: {
              components: {
                where: { type: "material" },
                include: { material: true },
              },
            },
          },
        },
      });

      type Agg = {
        key: string;
        name: string;
        unit: string;
        materialId: string | null;
        qtyNeeded: number;
        totalBudgeted: number;
      };
      const agg = new Map<string, Agg>();

      for (const obraItem of full?.obraItems || []) {
        const comps = obraItem.components.filter((c) => !c.material?.isProvision);
        for (const c of comps) {
          const qty = (c.quantity || 0) * (obraItem.quantity || 0);
          if (qty <= 0) continue;
          const budgeted = (c.unitCost || 0) * qty;
          const name = c.material?.name || c.description;
          const unit = c.material?.unit || c.unit;
          const key = c.materialId
            ? `mat:${c.materialId}`
            : `name:${name.trim().toLowerCase()}|${unit.trim().toLowerCase()}`;
          const prev = agg.get(key);
          if (prev) {
            prev.qtyNeeded += qty;
            prev.totalBudgeted += budgeted;
          } else {
            agg.set(key, {
              key,
              name,
              unit,
              materialId: c.materialId || null,
              qtyNeeded: qty,
              totalBudgeted: budgeted,
            });
          }
        }
      }

      const tracking = await prisma.shoppingItem.findMany({
        where: { projectId: id },
      });
      const trackingByKey = new Map<string, (typeof tracking)[number]>();
      for (const t of tracking) {
        const k = t.materialId
          ? `mat:${t.materialId}`
          : `name:${t.name.trim().toLowerCase()}|${t.unit.trim().toLowerCase()}`;
        trackingByKey.set(k, t);
      }

      for (const a of agg.values()) {
        const t = trackingByKey.get(a.key);
        const unitPrice =
          a.qtyNeeded > 0 && a.totalBudgeted > 0
            ? Math.round(a.totalBudgeted / a.qtyNeeded)
            : null;
        rows.push({
          name: a.name,
          unit: a.unit,
          qtyNeeded: a.qtyNeeded,
          qtyBought: t?.qtyBought || 0,
          unitPrice,
          notes: t?.notes || null,
          source: "budget",
        });
      }

      rows.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Aplicar filtro
    const filteredRows = rows.filter((r) => {
      const pend = r.qtyNeeded - r.qtyBought;
      if (filter === "pendiente") return pend > 0.001;
      if (filter === "comprado") return pend <= 0.001 && r.qtyNeeded > 0;
      return true;
    });

    const generatedAt = new Date().toLocaleDateString("es-CL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    const html = renderListaCompraHTML({
      projectName: project.name,
      budgetVersion: selectedBudget?.version || "—",
      filter,
      rows: filteredRows,
      generatedAt,
    });

    // Landscape lo handlea el CSS @page size: A4 landscape en el template HTML.
    const pdfBuffer = await renderPDF(html, {
      format: "A4",
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: buildListaCompraFooter(project.name),
      margin: { top: "10mm", bottom: "14mm", left: "12mm", right: "12mm" },
    });

    const filename = `BLARQ_ListaCompra_${project.name.replace(/\s+/g, "_")}.pdf`;
    const body = new Uint8Array(pdfBuffer.byteLength);
    body.set(pdfBuffer);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Error generating PDF:", error);
    return NextResponse.json({ error: "Error al generar PDF" }, { status: 500 });
  }
}
