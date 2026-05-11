// Reglas de auto-categorización de facturas por proveedor.
// Modelo: InvoiceCategorizationRule (rutIssuer único → categoryId? + projectId?).
//
// Una regla puede tener categoría, proyecto, o ambos. Al aplicarse, completa
// el campo correspondiente solo si en la factura está vacío (no pisa lo
// asignado manualmente).
//
// Aplicación:
//   - Sync SII / POST factura: si el RUT tiene regla, intenta auto-asignar.
//   - Bulk assign / PUT factura: si MJ asigna manualmente, upsertea la regla
//     con los campos que ella asignó.

import { prisma } from "@/lib/prisma";

/**
 * Aplica la regla guardada para el RUT emisor de una factura, si existe.
 * Completa categoría y/o proyecto solo si en la factura están vacíos.
 * Funciona para facturas recibidas y emitidas (las emitidas casi siempre
 * usan project rules — porque el cliente RUT identifica el proyecto).
 *
 * Devuelve detalle de qué se aplicó.
 */
export async function applyInvoiceRule(
  invoiceId: string
): Promise<{
  applied: boolean;
  categoryName?: string | null;
  projectName?: string | null;
}> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      type: true,
      categoryId: true,
      projectId: true,
      rutIssuer: true,
    },
  });
  if (!inv || !inv.rutIssuer) return { applied: false };

  const rule = await prisma.invoiceCategorizationRule.findUnique({
    where: { rutIssuer: inv.rutIssuer },
    include: {
      category: { select: { name: true } },
      project: { select: { name: true } },
    },
  });
  if (!rule) return { applied: false };

  const data: Record<string, unknown> = {};
  // Solo asignar categoría si la regla tiene una Y la factura no.
  if (rule.categoryId && !inv.categoryId) data.categoryId = rule.categoryId;
  // Solo asignar proyecto si la regla tiene uno Y la factura no.
  if (rule.projectId && !inv.projectId) data.projectId = rule.projectId;

  if (Object.keys(data).length === 0) return { applied: false };

  await prisma.invoice.update({ where: { id: inv.id }, data });
  await prisma.invoiceCategorizationRule.update({
    where: { id: rule.id },
    data: { hits: { increment: 1 } },
  });
  return {
    applied: true,
    categoryName: data.categoryId ? rule.category?.name ?? null : undefined,
    projectName: data.projectId ? rule.project?.name ?? null : undefined,
  };
}

/**
 * Crea/actualiza la regla para un RUT emisor.
 * Recibe categoryId y/o projectId — solo se actualizan los campos pasados.
 * Si no se pasa categoryId, no toca esa columna (mantiene la anterior si
 * existía). Idem projectId. Para BORRAR un campo se debe pasar null
 * explícito.
 *
 * Aplica RETROACTIVAMENTE: actualiza facturas del mismo RUT que estuvieran
 * sin asignar en los campos que la regla setea. Respeta asignaciones
 * manuales previas (no las pisa).
 */
export async function upsertInvoiceRule(
  rutIssuer: string,
  businessName: string | null,
  data: { categoryId?: string | null; projectId?: string | null }
): Promise<{
  created: boolean;
  updated: boolean;
  ruleId: string;
  appliedRetroactively: number;
}> {
  // Validar que al menos uno venga puesto (o sea valor no-undefined).
  if (data.categoryId === undefined && data.projectId === undefined) {
    throw new Error("upsertInvoiceRule: necesita categoryId o projectId");
  }

  const existing = await prisma.invoiceCategorizationRule.findUnique({
    where: { rutIssuer },
  });

  const ruleData: Record<string, unknown> = {};
  if (data.categoryId !== undefined) ruleData.categoryId = data.categoryId;
  if (data.projectId !== undefined) ruleData.projectId = data.projectId;
  if (businessName) ruleData.businessName = businessName;

  let result: { created: boolean; updated: boolean; ruleId: string };
  if (!existing) {
    const created = await prisma.invoiceCategorizationRule.create({
      data: { rutIssuer, businessName, hits: 1, ...ruleData },
    });
    result = { created: true, updated: false, ruleId: created.id };
  } else {
    // Detectar si CAMBIA algo respecto al existing — si solo incrementa
    // hits, no es "updated" desde el punto de vista de MJ.
    const changed =
      (data.categoryId !== undefined && existing.categoryId !== data.categoryId) ||
      (data.projectId !== undefined && existing.projectId !== data.projectId);
    const updated = await prisma.invoiceCategorizationRule.update({
      where: { id: existing.id },
      data: {
        ...ruleData,
        hits: changed ? 1 : { increment: 1 },
      },
    });
    result = { created: false, updated: changed, ruleId: updated.id };
  }

  // Aplicación retroactiva: actualizar facturas del RUT que estuvieran
  // vacías en los campos seteados por la regla. Respeta asignaciones
  // manuales previas. Hacemos 2 updates separados para que cada uno
  // respete su propio "no pisar lo asignado".
  let appliedRetroactively = 0;
  if (data.categoryId) {
    const r = await prisma.invoice.updateMany({
      where: { rutIssuer, categoryId: null },
      data: { categoryId: data.categoryId },
    });
    appliedRetroactively += r.count;
  }
  if (data.projectId) {
    const r = await prisma.invoice.updateMany({
      where: { rutIssuer, projectId: null },
      data: { projectId: data.projectId },
    });
    appliedRetroactively += r.count;
  }

  return { ...result, appliedRetroactively };
}
