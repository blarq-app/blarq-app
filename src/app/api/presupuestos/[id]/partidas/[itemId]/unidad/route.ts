/**
 * Cambiar la UNIDAD de una partida de obra dentro de la cotización (pendiente 156).
 *
 * Hasta ahora la unidad no se podía tocar en la cotización: venía del catálogo
 * y el catálogo empujaba sus cambios a las cotizaciones. Esa propagación está
 * apagada desde 2026-06-06, así que la unidad pasa a ser de la cotización.
 *
 * Qué hace (versión simple acordada con MJ el 2026-10-08):
 *   1. Pasar a GL CONVIERTE: cada línea del desglose que no es "%" se
 *      multiplica por la cantidad de la partida y la cantidad queda en 1. El
 *      total no cambia (lib/presupuesto/partidaGlobal.ts). Así el desglose
 *      pasa a ser "de toda la partida": 33,6 sacos y 48 M2 de maestro en vez
 *      de 0,7 saco y 1 M2 por cada m².
 *   2. Pasar a GL con la cantidad en 0: queda en 1 GL SIN multiplicar (no hay
 *      por qué multiplicar). El desglose queda como vino (por 1 m²) y MJ pone
 *      en cada línea cuántos m² son. Acá el total sí cambia: de $0 a lo que
 *      sume el desglose.
 *   3. Cualquier otro cambio (M2 → ML, o volver de GL a M2) solo cambia el
 *      rótulo. La cantidad la ajusta MJ.
 *   4. La partida se SUELTA del catálogo (catalogPartidaId = null): queda solo
 *      de esta cotización, y los botones "↑ … a catálogo" ya no pueden pisar
 *      el molde del catálogo con un desglose en otra unidad.
 *   5. Estados de pago: si la partida ya tiene avance o pagos (por lineageId,
 *      en cualquier EP del proyecto) y la cantidad cambia, NO se hace nada: el
 *      EP mide lo ejecutado en la unidad vieja (1,5 de 2,7 M2) y pasaría a
 *      medir contra 1 GL. Solo cambiar el rótulo se deja, con aviso.
 *
 * `simular: true` devuelve la cuenta sin escribir nada: la usa el editor para
 * mostrar la confirmación con los números de verdad.
 *
 * Solo en versiones borrador o enviado (mismo criterio que el desglose).
 * No toca metrics.ts: lee el total guardado, que la conversión deja igual.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/apiAuth";
import { recalcObraItemFromComponents } from "@/lib/catalog/recalcObraItem";
import { effectiveTotal, precioPorUnidad } from "@/lib/catalog/effectiveTotal";
import { esGlobal, pasarAGlobal } from "@/lib/presupuesto/partidaGlobal";

// Unidades de la partida: las del catálogo de partidas (PARTIDA_UNITS).
const UNIDADES = ["M2", "ML", "UN", "GL", "M3", "KG", "DIA", "HR"];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const gate = await requireSession();
  if (gate instanceof Response) return gate;

  try {
    const { id: budgetId, itemId } = await params;
    const body = await request.json().catch(() => ({}));
    const unidadNueva = String(body.unit ?? "").trim().toUpperCase();
    const simular = body.simular === true;
    if (!UNIDADES.includes(unidadNueva)) {
      return NextResponse.json({ error: "Unidad no válida" }, { status: 400 });
    }

    const item = await prisma.obraItem.findUnique({
      where: { id: itemId },
      include: {
        components: { orderBy: { sortOrder: "asc" } },
        budgetVersion: { select: { status: true, projectId: true } },
      },
    });
    if (!item || item.budgetVersionId !== budgetId) {
      return NextResponse.json({ error: "Partida no encontrada" }, { status: 404 });
    }
    if (!["borrador", "enviado"].includes(item.budgetVersion.status)) {
      return NextResponse.json(
        { error: "Solo se puede cambiar la unidad en versiones en borrador o enviadas." },
        { status: 400 }
      );
    }

    const cantidadAntes = item.quantity ?? 0;
    const aGlobal = esGlobal(unidadNueva);
    // Solo pasar a GL toca la cantidad; volver de GL o M2 → ML es rótulo.
    const cantidadNueva = aGlobal ? 1 : cantidadAntes;
    const cambiaCantidad = cantidadNueva !== cantidadAntes;
    // Con cantidad 0 no se multiplica: el desglose queda por 1 unidad.
    const multiplica = cambiaCantidad && cantidadAntes > 0;
    const cambiaRotulo = unidadNueva !== (item.unit ?? "").trim().toUpperCase();
    if (!cambiaCantidad && !cambiaRotulo) {
      return NextResponse.json({ sinCambios: true });
    }

    const conversion = multiplica ? pasarAGlobal(item, item.components) : null;
    if (conversion && !conversion.ok) {
      return NextResponse.json({ error: conversion.error }, { status: 400 });
    }

    // Avance o pagos en estados de pago de esta partida (cualquier versión:
    // el EP sigue a la partida por lineageId).
    const avance = await prisma.estadoPagoItem.findMany({
      where: {
        lineageId: item.lineageId,
        estadoPago: { projectId: item.budgetVersion.projectId },
        OR: [{ quantityExecuted: { gt: 0 } }, { amountPaid: { gt: 0 } }],
      },
      select: {
        estadoPago: { select: { number: true, maestro: { select: { name: true } } } },
      },
    });
    const enQueEP = avance
      .map((a) => `el estado de pago N° ${a.estadoPago.number}${a.estadoPago.maestro ? ` de ${a.estadoPago.maestro.name}` : ""}`)
      .join(", ");
    const bloqueo =
      cambiaCantidad && avance.length > 0
        ? `Esta partida ya tiene avance en ${enQueEP}, medido en ${item.unit}. Si pasa a ${cantidadNueva} ${unidadNueva}, el estado de pago mediría otra cosa. No se cambió nada.`
        : null;
    const avisoEP =
      !cambiaCantidad && avance.length > 0
        ? `Esta partida tiene avance en ${enQueEP}. El estado de pago va a mostrar la unidad nueva con la misma cantidad.`
        : null;

    // Precio por unidad hoy y después. Con desglose sale del desglose (la misma
    // cuenta del recálculo); sin desglose, del P.U. guardado.
    const puAntes = item.components.length > 0 ? precioPorUnidad(item.components) : item.unitPrice;
    const puDespues = conversion?.ok ? conversion.precioUnitarioDespues : puAntes;
    const nuevas = item.components.map((c) => {
      const l = conversion?.ok ? conversion.lineas.find((x) => x.id === c.id) : undefined;
      return l ? { ...c, quantity: l.despues } : c;
    });
    const lineas = conversion?.ok
      ? conversion.lineas.map((l) => {
          const c = item.components.find((x) => x.id === l.id)!;
          const n = nuevas.find((x) => x.id === l.id)!;
          return {
            descripcion: c.description,
            unidad: c.unit,
            cantidadAntes: l.antes,
            cantidadDespues: l.despues,
            montoAntes: effectiveTotal(c, item.components),
            montoDespues: effectiveTotal(n, nuevas),
          };
        })
      : [];

    const resumen = {
      unidadAntes: item.unit,
      unidadDespues: unidadNueva,
      cantidadAntes,
      cantidadDespues: cantidadNueva,
      // "convierte" (multiplica el desglose), "sin-multiplicar" (cantidad 0 →
      // 1 GL) o "rotulo" (solo cambia el nombre de la unidad).
      modo: multiplica ? "convierte" : cambiaCantidad ? "sin-multiplicar" : "rotulo",
      precioUnitarioAntes: puAntes,
      precioUnitarioDespues: puDespues,
      totalAntes: item.total,
      totalDespues: puDespues * cantidadNueva,
      lineas,
      tieneDesglose: item.components.length > 0,
      // Para la fila "Pérdida, leyes y margen (%): igual" de la ventana.
      hayPorcentajes: item.components.some((c) => c.unit === "%"),
      sueltaDelCatalogo: !!item.catalogPartidaId,
      avisoEP,
      bloqueo,
    };

    if (simular) return NextResponse.json(resumen);
    if (bloqueo) return NextResponse.json({ error: bloqueo }, { status: 409 });

    const sinDesglose = conversion?.ok ? conversion.montosSinDesglose : null;
    await prisma.$transaction([
      ...(conversion?.ok
        ? conversion.lineas.map((l) =>
            prisma.obraItemComponent.update({
              where: { id: l.id },
              data: { quantity: l.despues },
            })
          )
        : []),
      prisma.obraItem.update({
        where: { id: itemId },
        data: {
          unit: unidadNueva,
          quantity: cantidadNueva,
          // Solo de esta cotización: ya no es la partida del catálogo.
          catalogPartidaId: null,
          isCustomized: true,
          ...(sinDesglose
            ? {
                unitPrice: sinDesglose.unitPrice,
                costMaterial: sinDesglose.costMaterial,
                costLabor: sinDesglose.costLabor,
                costTools: sinDesglose.costTools,
                costSubcontract: sinDesglose.costSubcontract,
                costLoss: sinDesglose.costLoss,
                costMargin: sinDesglose.costMargin,
              }
            : {}),
          // Sin desglose el total se escribe acá (con desglose lo deja el
          // recálculo de abajo). Cubre también cantidad 0 → 1 GL.
          ...(item.components.length === 0
            ? { total: (sinDesglose?.unitPrice ?? item.unitPrice) * cantidadNueva }
            : {}),
        },
      }),
    ]);
    // Con desglose, P.U., total y los 6 montos los deja el recálculo de
    // siempre (misma cuenta que se usó arriba para mostrar los números).
    if (item.components.length > 0) await recalcObraItemFromComponents(itemId);

    const fresco = await prisma.obraItem.findUnique({
      where: { id: itemId },
      include: {
        components: {
          orderBy: { sortOrder: "asc" },
          include: { material: { select: { isProvision: true } } },
        },
      },
    });
    return NextResponse.json({ ...resumen, item: fresco });
  } catch (error) {
    console.error("Error cambiando la unidad de la partida:", error);
    return NextResponse.json({ error: "Error al cambiar la unidad" }, { status: 500 });
  }
}
