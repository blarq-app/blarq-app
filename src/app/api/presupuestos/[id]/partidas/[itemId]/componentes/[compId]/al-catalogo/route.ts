/**
 * Sube UNA línea (componente) de una partida de la cotización a la partida
 * equivalente del catálogo. Es la dirección inversa al sync normal
 * (catálogo → borradores): acá MJ decide, caso a caso, "esta línea que edité
 * o agregué, guárdala también en el catálogo para la próxima vez".
 *
 * Granularidad elegida por MJ (2026-06-01): "solo lo que toqué" — sube
 * únicamente este componente, no la partida entera, y NO propaga a otras
 * cotizaciones (para eso está el botón de sync masivo). Por defecto no se
 * sube nada; solo al apretar el botón.
 *
 * Reglas:
 *  - La partida de la cotización debe estar vinculada al catálogo
 *    (catalogPartidaId). Si es una partida 100% manual sin catálogo, se
 *    responde 400 con un mensaje claro.
 *  - Si el componente ya venía del catálogo (originComponentId), se ACTUALIZA
 *    ese PartidaComponent. Si es nuevo, se CREA y se guarda el vínculo
 *    (originComponentId) para que el sync futuro lo reconozca.
 *  - Después se recalculan los totales de la partida del catálogo.
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { recalcPartidaTotals } from "@/lib/catalog/recalcPartida";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ itemId: string; compId: string }> }
) {
  try {
    const { itemId, compId } = await params;

    const comp = await prisma.obraItemComponent.findUnique({
      where: { id: compId },
      include: { obraItem: { select: { catalogPartidaId: true } } },
    });

    if (!comp || comp.obraItemId !== itemId) {
      return NextResponse.json(
        { error: "Componente no encontrado" },
        { status: 404 }
      );
    }

    const catalogPartidaId = comp.obraItem.catalogPartidaId;
    if (!catalogPartidaId) {
      return NextResponse.json(
        {
          error:
            "Esta partida no está vinculada al catálogo. Guardá primero la partida en el catálogo para poder subirle líneas.",
        },
        { status: 400 }
      );
    }

    // Campos que viajan al catálogo. NO copiamos isCustomized (ese flag es
    // propio de la cotización) ni appliedToComponentId (apunta a ids de la
    // cotización, no del catálogo).
    const payload = {
      type: comp.type,
      description: comp.description,
      unit: comp.unit,
      quantity: comp.quantity,
      unitCost: comp.unitCost,
      totalCost: comp.totalCost,
      materialId: comp.materialId,
      referenceLink: comp.referenceLink,
      appliedToType: comp.appliedToType,
    };

    // ¿El componente ya tenía origen en el catálogo y ese origen sigue vivo?
    let target = comp.originComponentId
      ? await prisma.partidaComponent.findUnique({
          where: { id: comp.originComponentId },
        })
      : null;
    if (target && target.partidaId !== catalogPartidaId) target = null;

    if (target) {
      await prisma.partidaComponent.update({
        where: { id: target.id },
        data: payload,
      });
    } else {
      const count = await prisma.partidaComponent.count({
        where: { partidaId: catalogPartidaId },
      });
      const created = await prisma.partidaComponent.create({
        data: { partidaId: catalogPartidaId, sortOrder: count, ...payload },
      });
      // Dejamos el vínculo para que el sync diferencial futuro lo reconozca.
      await prisma.obraItemComponent.update({
        where: { id: comp.id },
        data: { originComponentId: created.id },
      });
    }

    // Recalcula unitPrice + cost* de la partida del catálogo desde sus líneas.
    await recalcPartidaTotals(catalogPartidaId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error subiendo componente al catálogo:", error);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
