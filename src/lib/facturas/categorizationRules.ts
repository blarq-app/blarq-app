// Reglas de auto-categorización de facturas por proveedor.
// Modelo: InvoiceCategorizationRule (proveedor → categoryId? + projectId?).
//
// El proveedor se identifica por UNA de dos claves:
//   - rutIssuer: proveedores chilenos (tienen RUT). Caso normal.
//   - providerName (= businessName exacto): proveedores internacionales SIN
//     RUT (Google Workspace, Anthropic, Neon...). En esas facturas rutIssuer
//     viene null, así que la regla se guarda y matchea por el nombre exacto.
//
// Una regla puede tener categoría, proyecto, o ambos. Al aplicarse, completa
// el campo correspondiente solo si en la factura está vacío (no pisa lo
// asignado manualmente).
//
// Aplicación:
//   - Sync SII / POST factura: si el proveedor tiene regla, intenta auto-asignar.
//   - Bulk assign / PUT factura: si MJ asigna manualmente, upsertea la regla
//     con los campos que ella asignó.

import { prisma } from "@/lib/prisma";

// Construye el WHERE que identifica TODAS las facturas de un proveedor, sea
// por RUT (chileno) o por nombre exacto (internacional sin RUT). Es la única
// fuente de verdad del "match de proveedor" — la usan tanto el retroactivo
// del upsert como la edición de reglas, para no repetir la lógica (y no caer
// en el bug de matchear todas las facturas con rutIssuer null).
//
// OJO nombre-exacto: para el caso internacional exigimos rutIssuer null Y
// businessName idéntico. Nunca "contains" — arrastraría facturas equivocadas.
export function providerInvoiceWhere(
  rutIssuer: string | null,
  providerName: string | null
): { rutIssuer: string } | { rutIssuer: null; businessName: string } | null {
  if (rutIssuer) return { rutIssuer };
  if (providerName) return { rutIssuer: null, businessName: providerName };
  return null; // sin RUT ni nombre no se puede identificar al proveedor
}

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
      businessName: true,
    },
  });
  if (!inv) return { applied: false };

  // Buscar la regla del proveedor: por RUT si lo tiene, si no por nombre
  // exacto (proveedor internacional sin RUT).
  const where = inv.rutIssuer
    ? { rutIssuer: inv.rutIssuer }
    : inv.businessName
      ? { providerName: inv.businessName }
      : null;
  if (!where) return { applied: false };

  const rule = await prisma.invoiceCategorizationRule.findUnique({
    where,
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
 * Crea/actualiza la regla para un proveedor.
 *
 * El proveedor se identifica por RUT (chileno) o, si rutIssuer es null, por
 * el nombre exacto (businessName) — proveedor internacional sin RUT. En ese
 * caso la clave de la regla es providerName = businessName.
 *
 * Recibe categoryId y/o projectId — solo se actualizan los campos pasados.
 * Si no se pasa categoryId, no toca esa columna (mantiene la anterior si
 * existía). Idem projectId. Para BORRAR un campo se debe pasar null explícito.
 *
 * Aplica RETROACTIVAMENTE: actualiza facturas del mismo proveedor (mismo RUT,
 * o mismo nombre exacto si no hay RUT) que estuvieran sin asignar en los
 * campos que la regla setea. Respeta asignaciones manuales previas.
 *
 * Si no hay ni RUT ni nombre, no se puede identificar al proveedor: no crea
 * regla y devuelve todo en cero.
 */
export async function upsertInvoiceRule(
  rutIssuer: string | null,
  businessName: string | null,
  data: { categoryId?: string | null; projectId?: string | null }
): Promise<{
  created: boolean;
  updated: boolean;
  ruleId: string | null;
  appliedRetroactively: number;
}> {
  // Validar que al menos uno venga puesto (o sea valor no-undefined).
  if (data.categoryId === undefined && data.projectId === undefined) {
    throw new Error("upsertInvoiceRule: necesita categoryId o projectId");
  }

  // Clave del proveedor. Si no hay RUT, la clave es el nombre exacto.
  const providerName = rutIssuer ? null : businessName;
  if (!rutIssuer && !providerName) {
    // Ni RUT ni nombre → no identificamos al proveedor, no guardamos regla.
    return { created: false, updated: false, ruleId: null, appliedRetroactively: 0 };
  }
  const keyWhere = rutIssuer ? { rutIssuer } : { providerName: providerName! };

  const existing = await prisma.invoiceCategorizationRule.findUnique({
    where: keyWhere,
  });

  const ruleData: Record<string, unknown> = {};
  if (data.categoryId !== undefined) ruleData.categoryId = data.categoryId;
  if (data.projectId !== undefined) ruleData.projectId = data.projectId;
  if (businessName) ruleData.businessName = businessName;

  let result: { created: boolean; updated: boolean; ruleId: string };
  if (!existing) {
    const created = await prisma.invoiceCategorizationRule.create({
      data: { rutIssuer, providerName, businessName, hits: 1, ...ruleData },
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

  // Aplicación retroactiva: actualizar facturas del proveedor que estuvieran
  // vacías en los campos seteados por la regla. Respeta asignaciones manuales
  // previas. Hacemos 2 updates separados para que cada uno respete su propio
  // "no pisar lo asignado". El WHERE del proveedor (RUT o nombre exacto) sale
  // del helper compartido, para no repetir la lógica ni matchear de más.
  const provWhere = providerInvoiceWhere(rutIssuer, providerName);
  let appliedRetroactively = 0;
  if (data.categoryId && provWhere) {
    const r = await prisma.invoice.updateMany({
      where: { ...provWhere, categoryId: null },
      data: { categoryId: data.categoryId },
    });
    appliedRetroactively += r.count;
  }
  if (data.projectId && provWhere) {
    const r = await prisma.invoice.updateMany({
      where: { ...provWhere, projectId: null },
      data: { projectId: data.projectId },
    });
    appliedRetroactively += r.count;
  }

  return { ...result, appliedRetroactively };
}
