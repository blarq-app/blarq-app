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
 * Busca una factura RECIBIDA existente que corresponda a lo leído de la foto.
 *
 * Dos vías, en orden:
 *   1. FOLIO laxo (ignora ceros a la izquierda). Es la identidad fuerte.
 *   2. RESPALDO monto + fecha: si el folio NO calza (típico: la IA leyó mal
 *      un dígito de un papel térmico — caso real Sodimac 147040016 leído como
 *      14704016), buscamos una factura del mismo RUT con el MISMO total y
 *      fecha cercana (±3 días). Solo se acepta si hay UNA sola candidata así
 *      (si hay varias del mismo monto, es ambiguo → no adivinamos).
 *
 * Devuelve la factura o null.
 */
export async function findInvoiceByRutFolio(
  rutIssuer: string,
  folioNumber: string | null,
  totalAmount?: number | null,
  issueDate?: string | null // YYYY-MM-DD
): Promise<{
  id: string;
  projectId: string | null;
  categoryId: string | null;
  totalAmount: number;
  matchedBy: "folio" | "monto_fecha";
} | null> {
  const candidatas = await prisma.invoice.findMany({
    where: { type: "recibida", rutIssuer },
    select: {
      id: true,
      folioNumber: true,
      projectId: true,
      categoryId: true,
      totalAmount: true,
      issueDate: true,
    },
  });

  // Vía 1: folio laxo.
  if (folioNumber) {
    const hit = candidatas.find((c) => sameFolio(c.folioNumber, folioNumber));
    if (hit) {
      return {
        id: hit.id,
        projectId: hit.projectId,
        categoryId: hit.categoryId,
        totalAmount: hit.totalAmount,
        matchedBy: "folio",
      };
    }
  }

  // Vía 2: respaldo por MONTO exacto (cuando el folio no calzó).
  //
  // La identidad fuerte acá es RUT + total al peso: un monto exacto es muy
  // distintivo entre las compras de un proveedor. La fecha NO filtra duro —
  // la boleta térmica que se fotografía puede imprimirse días después de la
  // emisión del DTE (caso real: foto "17/05" pero la factura SII es del
  // 07/05). Usamos una ventana amplia (±30 días) solo para desempatar si
  // hubiera dos compras del mismo monto exacto; si hay una sola, la tomamos.
  if (totalAmount != null) {
    const mismoMonto = candidatas.filter(
      (c) => Math.round(c.totalAmount) === Math.round(totalAmount)
    );
    let elegida: (typeof candidatas)[number] | undefined;
    if (mismoMonto.length === 1) {
      elegida = mismoMonto[0];
    } else if (mismoMonto.length > 1 && issueDate) {
      // Varias del mismo monto → desempatar por fecha cercana (±30 días),
      // pero solo si UNA queda dentro de la ventana (si no, ambiguo → null).
      const target = new Date(issueDate).getTime();
      const VENTANA = 30 * 24 * 60 * 60 * 1000;
      const cerca = mismoMonto.filter(
        (c) => Math.abs(c.issueDate.getTime() - target) <= VENTANA
      );
      if (cerca.length === 1) elegida = cerca[0];
    }
    if (elegida) {
      return {
        id: elegida.id,
        projectId: elegida.projectId,
        categoryId: elegida.categoryId,
        totalAmount: elegida.totalAmount,
        matchedBy: "monto_fecha",
      };
    }
  }

  return null;
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

// ==================== FLUJO DE CONFIRMACIÓN (obra leída a mano) ====================
//
// Cuando la obra NO viene tipeada en el mensaje sino leída del manuscrito en
// la foto, NO asignamos a ciegas: creamos una etiqueta en estado
// "por_confirmar" y el bot manda botones Sí/No. Solo al tocar "Sí" se
// confirma (se aplica o pasa a "esperando"). Esto evita imputar a la obra
// equivocada por una lectura dudosa de la letra.

/**
 * Crea una etiqueta "por_confirmar" para que el usuario apruebe la obra
 * leída a mano antes de aplicarla. Devuelve el id (va en el callbackData
 * de los botones).
 */
export async function createPendingTagToConfirm(
  input: CreatePendingTagInput
): Promise<string> {
  const created = await prisma.pendingProjectTag.create({
    data: {
      rutIssuer: input.rutIssuer,
      folioNumber: input.folioNumber,
      totalAmount: input.totalAmount,
      issueDate: input.issueDate ? new Date(input.issueDate) : null,
      businessName: input.businessName,
      projectId: input.projectId,
      categoryId: input.categoryId,
      requestedBy: input.requestedBy,
      requestedByName: input.requestedByName,
      status: "por_confirmar",
    },
  });
  return created.id;
}

/**
 * Confirma (o descarta) una etiqueta "por_confirmar" tras el toque del botón.
 *
 * accept=false → la marca "descartada" y listo.
 * accept=true  → si la factura ya existe la asigna al toque; si no, la pasa a
 *   "esperando" para que el sync la aplique al llegar. Respeta lo manual.
 *
 * Devuelve un resumen para el mensaje de respuesta del bot.
 */
export async function resolvePendingTagConfirmation(
  tagId: string,
  accept: boolean
): Promise<{
  ok: boolean;
  outcome: "descartada" | "aplicada" | "en_espera" | "no_encontrada" | "ya_resuelta";
  projectName?: string | null;
  businessName?: string | null;
  folioNumber?: string | null;
}> {
  const tag = await prisma.pendingProjectTag.findUnique({
    where: { id: tagId },
    include: { project: { select: { name: true } } },
  });
  if (!tag) return { ok: false, outcome: "no_encontrada" };
  if (tag.status !== "por_confirmar") {
    // Ya se resolvió antes (doble toque del botón) — idempotente.
    return {
      ok: true,
      outcome: "ya_resuelta",
      projectName: tag.project?.name ?? null,
      businessName: tag.businessName,
      folioNumber: tag.folioNumber,
    };
  }

  if (!accept) {
    await prisma.pendingProjectTag.update({
      where: { id: tag.id },
      data: { status: "descartada" },
    });
    return {
      ok: true,
      outcome: "descartada",
      projectName: tag.project?.name ?? null,
      businessName: tag.businessName,
      folioNumber: tag.folioNumber,
    };
  }

  // Aceptada: ¿la factura ya existe? (folio o respaldo monto+fecha)
  const existing = tag.rutIssuer
    ? await findInvoiceByRutFolio(
        tag.rutIssuer,
        tag.folioNumber,
        tag.totalAmount,
        tag.issueDate ? tag.issueDate.toISOString().slice(0, 10) : null
      )
    : null;

  if (existing) {
    await applyTagToInvoice(
      existing.id,
      { projectId: existing.projectId, categoryId: existing.categoryId },
      tag.projectId,
      tag.categoryId
    );
    await prisma.pendingProjectTag.update({
      where: { id: tag.id },
      data: {
        status: "aplicada",
        appliedToInvoiceId: existing.id,
        appliedAt: new Date(),
      },
    });
    return {
      ok: true,
      outcome: "aplicada",
      projectName: tag.project?.name ?? null,
      businessName: tag.businessName,
      folioNumber: tag.folioNumber,
    };
  }

  // No existe todavía: pasa a "esperando" (el sync la aplicará al llegar).
  await prisma.pendingProjectTag.update({
    where: { id: tag.id },
    data: { status: "esperando" },
  });
  return {
    ok: true,
    outcome: "en_espera",
    projectName: tag.project?.name ?? null,
    businessName: tag.businessName,
    folioNumber: tag.folioNumber,
  };
}
