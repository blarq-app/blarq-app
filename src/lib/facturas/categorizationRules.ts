// Reglas de auto-categorización de facturas por proveedor.
// Modelo: InvoiceCategorizationRule (rutIssuer único → categoryId).
//
// Aplicación:
//   - Sync SII / POST factura: si el RUT tiene regla, asignar categoría auto.
//   - Bulk assign: cada asignación masiva crea/actualiza la regla.
//   - PUT factura: si MJ cambia la categoría manualmente, upsertea la regla.
//
// El centro de costo / proyecto NUNCA se auto-asigna acá — depende del
// contexto temporal de cada obra.

import { prisma } from "@/lib/prisma";

/**
 * Aplica la regla guardada para el RUT emisor de una factura, si existe.
 * Solo aplica a facturas RECIBIDAS sin categoría asignada todavía.
 *
 * Devuelve { applied, categoryName } cuando aplicó algo.
 */
export async function applyInvoiceRule(
  invoiceId: string
): Promise<{ applied: boolean; categoryName?: string }> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      type: true,
      categoryId: true,
      rutIssuer: true,
    },
  });
  if (!inv || inv.type !== "recibida" || inv.categoryId || !inv.rutIssuer) {
    return { applied: false };
  }

  const rule = await prisma.invoiceCategorizationRule.findUnique({
    where: { rutIssuer: inv.rutIssuer },
    include: { category: { select: { name: true } } },
  });
  if (!rule) return { applied: false };

  await prisma.invoice.update({
    where: { id: inv.id },
    data: { categoryId: rule.categoryId },
  });
  await prisma.invoiceCategorizationRule.update({
    where: { id: rule.id },
    data: { hits: { increment: 1 } },
  });
  return { applied: true, categoryName: rule.category.name };
}

/**
 * Crea/actualiza la regla para un RUT emisor → categoría.
 * Si ya existía con misma categoría, incrementa hits.
 * Si existía con otra categoría, sobrescribe.
 *
 * Aplica RETROACTIVAMENTE: actualiza categoryId en todas las facturas
 * recibidas del mismo RUT que estaban sin categoría asignada
 * (categoryId=null). Las que ya tenían otra categoría NO se tocan —
 * fue una decisión manual previa de MJ y se respeta.
 *
 * Devuelve { ..., appliedRetroactively } con cuántas facturas se
 * categorizaron retroactivamente.
 */
export async function upsertInvoiceRule(
  rutIssuer: string,
  businessName: string | null,
  categoryId: string
): Promise<{
  created: boolean;
  updated: boolean;
  ruleId: string;
  previousCategoryId?: string | null;
  appliedRetroactively: number;
}> {
  const existing = await prisma.invoiceCategorizationRule.findUnique({
    where: { rutIssuer },
  });

  let result: {
    created: boolean;
    updated: boolean;
    ruleId: string;
    previousCategoryId?: string | null;
  };

  if (!existing) {
    const created = await prisma.invoiceCategorizationRule.create({
      data: {
        rutIssuer,
        businessName,
        categoryId,
        hits: 1,
      },
    });
    result = { created: true, updated: false, ruleId: created.id };
  } else if (existing.categoryId === categoryId) {
    // Misma categoría → solo incrementa hits.
    const updated = await prisma.invoiceCategorizationRule.update({
      where: { id: existing.id },
      data: {
        hits: { increment: 1 },
        ...(businessName && { businessName }),
      },
    });
    result = { created: false, updated: false, ruleId: updated.id };
  } else {
    // Cambió la categoría → sobrescribe y resetea hits.
    const updated = await prisma.invoiceCategorizationRule.update({
      where: { id: existing.id },
      data: {
        categoryId,
        ...(businessName && { businessName }),
        hits: 1,
      },
    });
    result = {
      created: false,
      updated: true,
      ruleId: updated.id,
      previousCategoryId: existing.categoryId,
    };
  }

  // Aplicación retroactiva: actualizar facturas sin categoría asignada.
  const retroResult = await prisma.invoice.updateMany({
    where: {
      type: "recibida",
      rutIssuer,
      categoryId: null,
    },
    data: { categoryId },
  });

  return { ...result, appliedRetroactively: retroResult.count };
}
