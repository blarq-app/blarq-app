// Etiquetas de centro de costo "en espera" (modelo PendingProjectTag).
//
// Flujo: MJ/JT fotografían una factura y dicen la obra. La factura puede
// que todavía NO haya llegado por el sync del SII. Entonces:
//   - Si la factura YA existe → asignamos obra/categoría al toque.
//   - Si NO existe todavía → guardamos la intención (PendingProjectTag) y
//     el sync la aplica cuando la factura aparezca.
//
// Identidad de la factura objetivo: (rutIssuer, folioNumber), recibida.
// Comparamos folios de forma laxa (sin ceros a la izquierda) porque la
// lectura de la foto y el dato del SII pueden diferir en formato.

import { prisma } from "@/lib/prisma";

/** Compara dos folios ignorando ceros/espacios a la izquierda. */
function sameFolio(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) return false;
  const na = a.replace(/\D/g, "").replace(/^0+/, "");
  const nb = b.replace(/\D/g, "").replace(/^0+/, "");
  return na !== "" && na === nb;
}

/**
 * Busca una factura RECIBIDA existente por (rutIssuer, folioNumber).
 * Devuelve la factura o null. Si folio es null, no busca (sin folio no
 * podemos identificar la factura con seguridad).
 */
export async function findInvoiceByRutFolio(
  rutIssuer: string,
  folioNumber: string | null
): Promise<{
  id: string;
  projectId: string | null;
  categoryId: string | null;
} | null> {
  if (!folioNumber) return null;
  // Traemos las recibidas del RUT y comparamos folio de forma laxa.
  const candidatas = await prisma.invoice.findMany({
    where: { type: "recibida", rutIssuer },
    select: { id: true, folioNumber: true, projectId: true, categoryId: true },
  });
  const hit = candidatas.find((c) => sameFolio(c.folioNumber, folioNumber));
  return hit
    ? { id: hit.id, projectId: hit.projectId, categoryId: hit.categoryId }
    : null;
}

/**
 * Aplica directamente proyecto/categoría a una factura existente, sin pisar
 * lo ya asignado a mano. Devuelve qué se aplicó.
 */
export async function applyTagToInvoice(
  invoiceId: string,
  current: { projectId: string | null; categoryId: string | null },
  projectId: string | null,
  categoryId: string | null
): Promise<{ setProject: boolean; setCategory: boolean }> {
  const data: Record<string, unknown> = {};
  // Solo completa lo vacío — respeta una asignación manual previa.
  if (projectId && !current.projectId) data.projectId = projectId;
  if (categoryId && !current.categoryId) data.categoryId = categoryId;
  if (Object.keys(data).length > 0) {
    await prisma.invoice.update({ where: { id: invoiceId }, data });
  }
  return {
    setProject: "projectId" in data,
    setCategory: "categoryId" in data,
  };
}

export interface CreatePendingTagInput {
  rutIssuer: string;
  folioNumber: string | null;
  totalAmount: number | null;
  issueDate: string | null; // YYYY-MM-DD
  businessName: string | null;
  projectId: string;
  categoryId: string | null;
  requestedBy: string | null;
  requestedByName: string | null;
}

/**
 * Guarda una etiqueta en espera. Si ya hay una "esperando" para el mismo
 * (rutIssuer, folioNumber), la actualiza en vez de duplicar (caso: MJ
 * reenvía la foto corregida).
 */
export async function createPendingTag(
  input: CreatePendingTagInput
): Promise<string> {
  const existing = input.folioNumber
    ? await prisma.pendingProjectTag.findFirst({
        where: {
          rutIssuer: input.rutIssuer,
          folioNumber: input.folioNumber,
          status: "esperando",
        },
        select: { id: true },
      })
    : null;

  const data = {
    rutIssuer: input.rutIssuer,
    folioNumber: input.folioNumber,
    totalAmount: input.totalAmount,
    issueDate: input.issueDate ? new Date(input.issueDate) : null,
    businessName: input.businessName,
    projectId: input.projectId,
    categoryId: input.categoryId,
    requestedBy: input.requestedBy,
    requestedByName: input.requestedByName,
    status: "esperando",
  };

  if (existing) {
    await prisma.pendingProjectTag.update({ where: { id: existing.id }, data });
    return existing.id;
  }
  const created = await prisma.pendingProjectTag.create({ data });
  return created.id;
}

/**
 * Aplica las etiquetas en espera que matcheen una factura recién
 * llegada/actualizada por el sync. Se llama desde runSiiSync.
 *
 * Solo procesa facturas RECIBIDAS. Busca tags "esperando" del mismo RUT,
 * compara folio de forma laxa, aplica proyecto/categoría (sin pisar lo
 * manual) y marca la tag como "aplicada".
 *
 * Devuelve cuántas tags se aplicaron (0 en el caso normal).
 */
export async function applyPendingTagsForInvoice(
  invoiceId: string
): Promise<number> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      type: true,
      rutIssuer: true,
      folioNumber: true,
      projectId: true,
      categoryId: true,
    },
  });
  if (!inv || inv.type !== "recibida" || !inv.rutIssuer || !inv.folioNumber) {
    return 0;
  }

  const tags = await prisma.pendingProjectTag.findMany({
    where: { rutIssuer: inv.rutIssuer, status: "esperando" },
    select: { id: true, folioNumber: true, projectId: true, categoryId: true },
  });

  let applied = 0;
  let curProject = inv.projectId;
  let curCategory = inv.categoryId;

  for (const tag of tags) {
    if (!sameFolio(tag.folioNumber, inv.folioNumber)) continue;

    const r = await applyTagToInvoice(
      inv.id,
      { projectId: curProject, categoryId: curCategory },
      tag.projectId,
      tag.categoryId
    );
    if (r.setProject && tag.projectId) curProject = tag.projectId;
    if (r.setCategory && tag.categoryId) curCategory = tag.categoryId;

    await prisma.pendingProjectTag.update({
      where: { id: tag.id },
      data: {
        status: "aplicada",
        appliedToInvoiceId: inv.id,
        appliedAt: new Date(),
      },
    });
    applied++;
  }
  return applied;
}
