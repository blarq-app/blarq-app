import { computeObraBudgetTotals, validateObraDiscount } from "@/lib/projects/metrics";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { buildBudgetSnapshot } from "@/lib/catalog/budgetSnapshot";
import { requireSession } from "@/lib/apiAuth";
import { parseCondiciones } from "@/lib/presupuesto/condiciones";

// Actualizar presupuesto (observaciones, GG%, utilidad%, estado)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id } = await params;
    const data = await request.json();

    // Solo incluimos los campos que vienen en el body (PATCH-style sobre PUT).
    // Permite renombrar version (ej. "V3" → "Alternativa A") sin tocar el resto.
    const updateData: Record<string, unknown> = {};
    if (data.observations !== undefined) updateData.observations = data.observations;
    // Condiciones que salen en el PDF. Se guardan tal cual quedaron en el
    // editor (orden incluido). Lista vacía es válida: PDF sin observaciones.
    if (data.conditions !== undefined) {
      const limpias = parseCondiciones(data.conditions);
      if (!limpias) {
        return NextResponse.json(
          { error: "conditions debe ser una lista" },
          { status: 400 }
        );
      }
      updateData.conditions = limpias;
    }
    // Textos de portada del PDF. Vacío → null para que el generador use el default.
    if (data.coverTitle !== undefined)
      updateData.coverTitle = String(data.coverTitle).trim() || null;
    if (data.coverSubtitle !== undefined)
      updateData.coverSubtitle = String(data.coverSubtitle).trim() || null;
    if (data.coverNote !== undefined)
      updateData.coverNote = String(data.coverNote).trim() || null;
    if (data.ggPercentage !== undefined) updateData.ggPercentage = data.ggPercentage;
    if (data.utilityPercentage !== undefined) updateData.utilityPercentage = data.utilityPercentage;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.version !== undefined) {
      const v = String(data.version).trim();
      if (!v) {
        return NextResponse.json({ error: "El nombre no puede estar vacío" }, { status: 400 });
      }
      updateData.version = v;
    }

    // Nota: NO se auto-desaprueban otras versiones cuando se aprueba una.
    // El control de qué versión está aprobada lo lleva MJ manualmente
    // (puede des-aprobar clickeando el badge "✓ Aprobado"). Desde 2026-07-22
    // el Resumen muestra UNA sola versión (la última enviada/aprobada por
    // createdAt; ver selectVersion.ts) — ya no se suman versiones aprobadas,
    // así que dejar una vieja aprobada no infla el total: gana la más nueva.

    const current = await prisma.budgetVersion.findUnique({
      where: { id }, include: { obraItems: true, paymentTerms: true },
    });
    if (!current) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });
    if (data.discountAmount !== undefined) {
      if (current.type !== "obra") {
        return NextResponse.json({ error: "El descuento fijo está disponible solo para obra." }, { status: 400 });
      }
      const totals = computeObraBudgetTotals({ ...current,
        ggPercentage: data.ggPercentage ?? current.ggPercentage,
        utilityPercentage: data.utilityPercentage ?? current.utilityPercentage,
      });
      const error = validateObraDiscount(data.discountAmount, totals.totalOriginal);
      if (error) return NextResponse.json({ error }, { status: 400 });
      updateData.discountAmount = data.discountAmount;
    }
    const budget = await prisma.$transaction(async (tx) => {
      const updated = await tx.budgetVersion.update({ where: { id }, data: updateData });
      if (current.type === "obra" &&
          (data.discountAmount !== undefined || data.ggPercentage !== undefined || data.utilityPercentage !== undefined)) {
        const { totalFinal } = computeObraBudgetTotals({ ...updated, obraItems: current.obraItems });
        for (const term of current.paymentTerms) {
          await tx.paymentTerm.update({ where: { id: term.id }, data: { amount: totalFinal * term.percentage / 100 } });
        }
      }
      return updated;
    });

    // Foto al enviar/cerrar (tarea 9): cuando la versión pasa a "enviado" se
    // saca una foto fresca (re-enviar = foto nueva). Al pasar a "aprobado"
    // solo si todavía no había foto (cubre el caso borrador→aprobado directo).
    // La foto deja registro de lo enviado y habilita "volver a lo enviado".
    // El deslinkado del catálogo ya lo da el status ≠ borrador (el sync solo
    // toca borradores) — la foto es el respaldo, no el candado.
    if (data.status === "enviado" || data.status === "aprobado") {
      const necesitaFoto =
        data.status === "enviado" ||
        !(await prisma.budgetVersion.findUnique({
          where: { id },
          select: { sentSnapshot: true },
        }))?.sentSnapshot;
      if (necesitaFoto) {
        const snap = await buildBudgetSnapshot(id);
        await prisma.budgetVersion.update({
          where: { id },
          // JSON puro (sin Date crudos de los items de muebles/artefactos).
          data: { sentSnapshot: JSON.parse(JSON.stringify(snap)), sentAt: new Date() },
        });
      }
    }

    // Cuando se aprueba un presupuesto de obra, el proyecto pasa a "ejecucion"
    // y se le asigna numeroProyecto si aún no lo tenía (transición cotizacion→ejecucion).
    if (data.status === "aprobado" && budget.type === "obra") {
      const proj = await prisma.project.findUnique({
        where: { id: budget.projectId },
        select: { numeroProyecto: true },
      });

      let numeroProyecto = proj?.numeroProyecto ?? null;
      if (numeroProyecto == null) {
        const max = await prisma.project.aggregate({
          _max: { numeroProyecto: true },
        });
        numeroProyecto = (max._max.numeroProyecto ?? 0) + 1;
      }

      await prisma.project.update({
        where: { id: budget.projectId },
        data: {
          currentVersion: budget.version,
          status: "ejecucion",
          numeroProyecto,
        },
      });
    }

    return NextResponse.json(budget);
  } catch (error) {
    console.error("Error updating budget:", error);
    return NextResponse.json(
      { error: "Error al actualizar presupuesto" },
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

    // Solo se pueden borrar borradores y rechazadas. Una versión aprobada
    // implica que ya hay decisiones de negocio tomadas encima (puede tener
    // EPs ligados por lineageId, factura asociada al presupuesto cliente,
    // etc) — borrarla rompería trazabilidad. Si MJ realmente quiere
    // borrarla, primero tiene que cambiar el status (no expuesto en UI).
    const bv = await prisma.budgetVersion.findUnique({
      where: { id },
      select: { status: true, type: true, _count: { select: { estadosPago: true } } },
    });
    if (!bv) return NextResponse.json({ error: "No existe" }, { status: 404 });
    if (bv.status === "aprobado") {
      return NextResponse.json(
        { error: "No se puede borrar una versión aprobada. Cámbiale el status primero si es necesario." },
        { status: 400 }
      );
    }
    if (bv._count.estadosPago > 0) {
      return NextResponse.json(
        { error: `No se puede borrar: tiene ${bv._count.estadosPago} estado${bv._count.estadosPago > 1 ? "s" : ""} de pago asociado${bv._count.estadosPago > 1 ? "s" : ""}.` },
        { status: 400 }
      );
    }

    await prisma.budgetVersion.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting budget:", error);
    return NextResponse.json(
      { error: "Error al eliminar presupuesto" },
      { status: 500 }
    );
  }
}
