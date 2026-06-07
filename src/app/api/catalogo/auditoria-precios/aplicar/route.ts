/**
 * Aplica SOLO los cambios que MJ seleccionó en el panel "Actualizar".
 *
 * Regla MJ (2026-06-06): nada del catálogo entra solo. El cliente manda la
 * lista de cambios elegidos (kind + id + obraItemId); el servidor RE-VALIDA
 * cada uno antes de tocar nada (solo borrador, no customizado, lineage no
 * congelado, el cambio sigue siendo real) y aplica únicamente esos. Lo no
 * seleccionado queda intacto.
 *
 * POST { budgetVersionId, changes: AuditChangeRef[] }
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { recalcObraItemFromComponents } from "@/lib/catalog/recalcObraItem";
import { getFrozenLineageIds } from "@/lib/catalog/frozenLineage";
import type { AuditChangeRef } from "@/lib/catalog/auditChanges";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      budgetVersionId?: string;
      changes?: AuditChangeRef[];
    };
    const { budgetVersionId, changes } = body;

    if (!budgetVersionId || !Array.isArray(changes)) {
      return NextResponse.json(
        { error: "Faltan budgetVersionId o changes" },
        { status: 400 }
      );
    }

    const bv = await prisma.budgetVersion.findUnique({
      where: { id: budgetVersionId },
      select: { status: true },
    });
    if (!bv) {
      return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });
    }
    if (bv.status !== "borrador") {
      return NextResponse.json(
        { error: "Solo se pueden actualizar presupuestos en borrador" },
        { status: 400 }
      );
    }

    // Cache de lineages congelados por (projectId|type).
    const frozenCache = new Map<string, Set<string>>();
    const isFrozen = async (projectId: string, type: string, lineageId: string) => {
      const key = `${projectId}|${type}`;
      if (!frozenCache.has(key)) {
        frozenCache.set(key, await getFrozenLineageIds(projectId, type));
      }
      return frozenCache.get(key)!.has(lineageId);
    };

    const affected = new Set<string>();
    let updated = 0;
    let added = 0;
    let removed = 0;
    let skipped = 0;

    for (const ch of changes) {
      if (!ch || !ch.kind || !ch.id || !ch.obraItemId) {
        skipped++;
        continue;
      }

      // ── UPDATE ────────────────────────────────────────────────────
      if (ch.kind === "update") {
        const c = await prisma.obraItemComponent.findUnique({
          where: { id: ch.id },
          include: {
            material: true,
            obraItem: {
              select: {
                id: true,
                isCustomized: true,
                lineageId: true,
                budgetVersionId: true,
                budgetVersion: { select: { status: true, projectId: true, type: true } },
              },
            },
          },
        });
        if (
          !c ||
          c.obraItemId !== ch.obraItemId ||
          c.obraItem.budgetVersionId !== budgetVersionId ||
          c.obraItem.budgetVersion.status !== "borrador" ||
          c.isCustomized ||
          c.obraItem.isCustomized ||
          !c.material
        ) {
          skipped++;
          continue;
        }
        if (
          await isFrozen(
            c.obraItem.budgetVersion.projectId,
            c.obraItem.budgetVersion.type,
            c.obraItem.lineageId
          )
        ) {
          skipped++;
          continue;
        }
        const stillStale =
          c.description !== c.material.name ||
          Math.abs(c.unitCost - c.material.netPrice) > 0.01 ||
          (c.referenceLink ?? null) !== (c.material.referenceLink ?? null);
        if (!stillStale) {
          skipped++;
          continue;
        }
        await prisma.obraItemComponent.update({
          where: { id: c.id },
          data: {
            description: c.material.name,
            unit: c.material.unit,
            unitCost: c.material.netPrice,
            referenceLink: c.material.referenceLink,
          },
        });
        updated++;
        affected.add(c.obraItemId);
        continue;
      }

      // ── REMOVE ────────────────────────────────────────────────────
      if (ch.kind === "remove") {
        const c = await prisma.obraItemComponent.findUnique({
          where: { id: ch.id },
          include: {
            obraItem: {
              select: {
                id: true,
                isCustomized: true,
                lineageId: true,
                catalogPartidaId: true,
                budgetVersionId: true,
                budgetVersion: { select: { status: true, projectId: true, type: true } },
              },
            },
          },
        });
        if (
          !c ||
          c.obraItemId !== ch.obraItemId ||
          c.obraItem.budgetVersionId !== budgetVersionId ||
          c.obraItem.budgetVersion.status !== "borrador" ||
          c.isCustomized ||
          !c.originComponentId ||
          !c.obraItem.catalogPartidaId
        ) {
          skipped++;
          continue;
        }
        if (
          await isFrozen(
            c.obraItem.budgetVersion.projectId,
            c.obraItem.budgetVersion.type,
            c.obraItem.lineageId
          )
        ) {
          skipped++;
          continue;
        }
        // Re-validar que el origen ya no exista en el catálogo (es huérfano).
        const stillExists = await prisma.partidaComponent.findFirst({
          where: { id: c.originComponentId, partidaId: c.obraItem.catalogPartidaId },
          select: { id: true },
        });
        if (stillExists) {
          skipped++;
          continue;
        }
        await prisma.obraItemComponent.delete({ where: { id: c.id } });
        removed++;
        affected.add(c.obraItemId);
        continue;
      }

      // ── ADD ───────────────────────────────────────────────────────
      if (ch.kind === "add") {
        const oi = await prisma.obraItem.findUnique({
          where: { id: ch.obraItemId },
          select: {
            id: true,
            isCustomized: true,
            lineageId: true,
            catalogPartidaId: true,
            budgetVersionId: true,
            budgetVersion: { select: { status: true, projectId: true, type: true } },
            components: { select: { id: true, originComponentId: true } },
            discardedCatalogComponents: { select: { partidaComponentId: true } },
          },
        });
        if (
          !oi ||
          oi.budgetVersionId !== budgetVersionId ||
          oi.budgetVersion.status !== "borrador" ||
          oi.isCustomized ||
          !oi.catalogPartidaId
        ) {
          skipped++;
          continue;
        }
        if (
          await isFrozen(
            oi.budgetVersion.projectId,
            oi.budgetVersion.type,
            oi.lineageId
          )
        ) {
          skipped++;
          continue;
        }
        // El molde del catálogo (PartidaComponent) tiene que existir en ESA partida.
        const cat = await prisma.partidaComponent.findFirst({
          where: { id: ch.id, partidaId: oi.catalogPartidaId },
        });
        if (!cat) {
          skipped++;
          continue;
        }
        // No re-agregar si ya está presente (por origin) o si fue descartado.
        const alreadyPresent = oi.components.some(
          (c) => c.originComponentId === cat.id
        );
        const wasDiscarded = oi.discardedCatalogComponents.some(
          (d) => d.partidaComponentId === cat.id
        );
        if (alreadyPresent || wasDiscarded) {
          skipped++;
          continue;
        }

        // Datos visibles desde el material si está linkeado.
        let description = cat.description;
        let unit = cat.unit;
        let unitCost = cat.unitCost;
        let referenceLink = cat.referenceLink;
        if (cat.materialId) {
          const mat = await prisma.materialCatalog.findUnique({
            where: { id: cat.materialId },
          });
          if (mat) {
            description = mat.name;
            unit = mat.unit;
            unitCost = mat.netPrice;
            referenceLink = mat.referenceLink;
          }
        }

        // appliedToComponentId (caso pérdida %): mapear el target del catálogo
        // al componente del proyecto que ya lo referencia por origin.
        let appliedToComponentId: string | null = null;
        if (cat.appliedToComponentId) {
          const target = oi.components.find(
            (c) => c.originComponentId === cat.appliedToComponentId
          );
          appliedToComponentId = target?.id ?? null;
        }

        await prisma.obraItemComponent.create({
          data: {
            obraItemId: oi.id,
            type: cat.type,
            description,
            unit,
            quantity: cat.quantity,
            unitCost,
            totalCost: cat.totalCost,
            referenceLink,
            materialId: cat.materialId,
            sortOrder: cat.sortOrder,
            appliedToType: cat.appliedToType,
            appliedToComponentId,
            originComponentId: cat.id,
          },
        });
        added++;
        affected.add(oi.id);
        continue;
      }

      skipped++;
    }

    // Recalcular cada partida tocada (encabezado = espejo del desglose).
    for (const itemId of affected) {
      await recalcObraItemFromComponents(itemId);
    }

    return NextResponse.json({
      ok: true,
      updated,
      added,
      removed,
      skipped,
      obraItemsRecalculated: affected.size,
    });
  } catch (error) {
    console.error("Error al aplicar cambios:", error);
    return NextResponse.json({ error: "Error al aplicar cambios" }, { status: 500 });
  }
}
