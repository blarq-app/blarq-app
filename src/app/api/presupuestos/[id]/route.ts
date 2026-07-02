import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { buildBudgetSnapshot } from "@/lib/catalog/budgetSnapshot";
import { requireSession } from "@/lib/apiAuth";

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
    // Caso de uso: anexos (Aguirre V7 + V4-BAÑO-VISITAS), donde múltiples
    // versiones de obra aprobadas se SUMAN al Total Acordado en metrics.
    // El control de qué versión está aprobada lo lleva MJ manualmente
    // (puede des-aprobar clickeando el badge "✓ Aprobado").

    const budget = await prisma.budgetVersion.update({
      where: { id },
      data: updateData,
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
