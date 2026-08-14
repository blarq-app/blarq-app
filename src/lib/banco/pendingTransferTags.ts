// Etiquetas de obra + concepto "en espera" para los traspasos a Sueldos
// (modelo PendingTransferTag).
//
// Flujo: MJ se pasa plata de Operativa a Sueldos y le manda al bot el
// pantallazo del comprobante diciendo la obra y el concepto. En ese momento la
// transferencia normalmente TODAVÍA NO existe en la app — entra recién cuando
// se importa la cartola del banco. Entonces:
//   - Si el traspaso YA existe → se etiqueta al toque.
//   - Si NO existe todavía → se guarda la intención y el import la aplica sola
//     al detectar el par (ver /api/banco/import).
//
// Identidad del traspaso: FECHA + MONTO. Es lo único duro que trae el papel de
// un comprobante entre dos cuentas propias (no hay RUT emisor ni folio, que es
// lo que identifica una factura). Medido en la base viva sobre los 38 traspasos
// históricos a Sueldos: nunca hubo dos del mismo monto el mismo día, ni con
// ventana de ±1 día. Aun así, el criterio es el mismo que en toda la
// conciliación: si aparece más de un candidato NO se elige — se pregunta.

import { prisma } from "@/lib/prisma";
import {
  etiquetarTraspaso,
  type ConceptoTraspaso,
} from "@/lib/banco/internalTransferTags";

// Tolerancia de fecha entre el comprobante y la cartola.
//
// Empezó en 1 día y NO alcanzaba: el primer traspaso real que MJ mandó por el
// bot (14-ago-2026, viernes 16:23) el banco lo asentó el LUNES 17. Tres días de
// diferencia, así que el bot no lo encontró y contestó "todavía no está en la
// app" cuando sí estaba. Un fin de semana largo puede estirarlo más.
//
// 15 días es holgado a propósito, porque el que manda acá es el MONTO: medido
// sobre los 41 traspasos históricos a Sueldos, ningún monto tiene un gemelo
// dentro de ±60 días, y en toda la historia solo un monto se repitió alguna vez
// ($2.400.000, dos veces, con meses de distancia). La fecha sirve para acotar,
// no para identificar. Y si aun así aparece más de un candidato, no se elige:
// se pregunta.
const VENTANA_DIAS = 15;

export interface TraspasoCandidato {
  id: string;
  date: Date;
  amount: number;
  projectId: string | null;
  projectName: string | null;
  internalConcepto: string | null;
  internalTransferToId: string | null;
  cuenta: string;
}

/**
 * Busca traspasos internos que calcen con la fecha y el monto del comprobante.
 *
 * Devuelve UN candidato por par (no los dos lados): de cada transferencia
 * interesa el lado que ENTRA a la cuenta Sueldos, que es el que suman los
 * cálculos de "ya transferido". Etiquetar ese lado etiqueta igual los dos
 * (ver etiquetarTraspaso).
 *
 * Cero candidatos = todavía no llegó del banco. Más de uno = ambiguo, el que
 * llama tiene que preguntar en vez de elegir.
 */
export async function buscarTraspasosPorFechaMonto(
  fecha: Date,
  monto: number
): Promise<TraspasoCandidato[]> {
  const desde = new Date(fecha);
  desde.setUTCDate(desde.getUTCDate() - VENTANA_DIAS);
  const hasta = new Date(fecha);
  hasta.setUTCDate(hasta.getUTCDate() + VENTANA_DIAS);
  hasta.setUTCHours(23, 59, 59, 999);

  const movs = await prisma.bankMovement.findMany({
    where: {
      category: "transfer_interno",
      date: { gte: desde, lte: hasta },
    },
    select: {
      id: true,
      date: true,
      amount: true,
      projectId: true,
      internalConcepto: true,
      internalTransferToId: true,
      project: { select: { name: true } },
      bankAccount: { select: { alias: true, role: true } },
    },
  });

  // El comprobante no trae signo: comparamos por monto absoluto, al peso.
  const objetivo = Math.round(Math.abs(monto));
  const calzan = movs.filter(
    (m) => Math.round(Math.abs(m.amount)) === objetivo
  );

  // Quedarnos con un lado por par. Ordenamos primero el que ENTRA a Sueldos
  // para que sea ese el representante elegido.
  const ordenados = [...calzan].sort((a, b) => {
    const puntaje = (m: (typeof calzan)[number]) =>
      m.bankAccount.role === "salary_fund" && m.amount > 0 ? 0 : 1;
    return puntaje(a) - puntaje(b);
  });

  const vistos = new Set<string>();
  const candidatos: TraspasoCandidato[] = [];
  for (const m of ordenados) {
    if (vistos.has(m.id)) continue;
    vistos.add(m.id);
    if (m.internalTransferToId) vistos.add(m.internalTransferToId);
    candidatos.push({
      id: m.id,
      date: m.date,
      amount: m.amount,
      projectId: m.projectId,
      projectName: m.project?.name ?? null,
      internalConcepto: m.internalConcepto,
      internalTransferToId: m.internalTransferToId,
      cuenta: m.bankAccount.alias,
    });
  }
  return candidatos;
}

/**
 * Rearma un candidato a partir del id del movimiento. Lo usa el bot cuando MJ
 * eligió con un botón cuál de los traspasos era.
 */
export async function getCandidatoPorId(
  movementId: string
): Promise<TraspasoCandidato | null> {
  const m = await prisma.bankMovement.findUnique({
    where: { id: movementId },
    select: {
      id: true,
      date: true,
      amount: true,
      projectId: true,
      internalConcepto: true,
      internalTransferToId: true,
      category: true,
      project: { select: { name: true } },
      bankAccount: { select: { alias: true } },
    },
  });
  if (!m || m.category !== "transfer_interno") return null;
  return {
    id: m.id,
    date: m.date,
    amount: m.amount,
    projectId: m.projectId,
    projectName: m.project?.name ?? null,
    internalConcepto: m.internalConcepto,
    internalTransferToId: m.internalTransferToId,
    cuenta: m.bankAccount.alias,
  };
}

export interface ResultadoEtiquetado {
  setProject: boolean;
  setConcepto: boolean;
  // Lo que YA tenía puesto y no se pisó. Sirve para avisarle a MJ.
  yaTeniaProject: string | null; // nombre de la obra que ya estaba
  yaTeniaConcepto: string | null;
}

/**
 * Etiqueta un traspaso con obra y concepto, SIN pisar lo que ya estaba puesto.
 *
 * Mismo criterio que las facturas (applyTagToInvoice): una asignación hecha a
 * mano manda sobre la que llega por el bot. Si ya tenía obra o concepto, se
 * deja como está y se informa para que el bot lo diga.
 */
export async function etiquetarTraspasoSinPisar(
  candidato: TraspasoCandidato,
  projectId: string,
  concepto: ConceptoTraspaso
): Promise<ResultadoEtiquetado> {
  const data: { projectId?: string; internalConcepto?: string } = {};
  if (!candidato.projectId) data.projectId = projectId;
  if (!candidato.internalConcepto) data.internalConcepto = concepto;

  if (Object.keys(data).length > 0) {
    await etiquetarTraspaso(
      { id: candidato.id, internalTransferToId: candidato.internalTransferToId },
      data
    );
  }
  return {
    setProject: "projectId" in data,
    setConcepto: "internalConcepto" in data,
    yaTeniaProject: candidato.projectId ? candidato.projectName : null,
    yaTeniaConcepto: candidato.internalConcepto,
  };
}

export interface CreatePendingTransferTagInput {
  transferDate: Date;
  amount: number;
  bankName: string | null;
  destination: string | null;
  projectId: string;
  // null = MJ no dijo si el traspaso es de obra o de muebles. La etiqueta nace
  // "por_confirmar" y el bot le manda los dos botones.
  concepto: ConceptoTraspaso | null;
  requestedBy: string | null;
  requestedByName: string | null;
}

/**
 * Guarda una etiqueta (en espera, o por confirmar si falta el concepto). Si ya
 * hay una sin resolver para la misma fecha y monto, la actualiza en vez de
 * duplicar — el caso real es MJ reenviando el mismo comprobante porque se
 * equivocó de obra o de concepto.
 */
export async function createPendingTransferTag(
  input: CreatePendingTransferTagInput
): Promise<string> {
  const existing = await prisma.pendingTransferTag.findFirst({
    where: {
      status: { in: ["esperando", "por_confirmar"] },
      transferDate: input.transferDate,
      amount: input.amount,
    },
    select: { id: true },
  });

  const data = {
    transferDate: input.transferDate,
    amount: input.amount,
    bankName: input.bankName,
    destination: input.destination,
    projectId: input.projectId,
    concepto: input.concepto,
    requestedBy: input.requestedBy,
    requestedByName: input.requestedByName,
    status: input.concepto ? "esperando" : "por_confirmar",
  };

  if (existing) {
    await prisma.pendingTransferTag.update({ where: { id: existing.id }, data });
    return existing.id;
  }
  const created = await prisma.pendingTransferTag.create({ data });
  return created.id;
}

/**
 * Completa el concepto de una etiqueta "por_confirmar" (el toque del botón
 * Obra / Muebles). Idempotente: si ya se había resuelto, no rompe.
 */
export async function completarConcepto(
  tagId: string,
  concepto: ConceptoTraspaso
): Promise<{ ok: boolean; tagId: string } | null> {
  const tag = await prisma.pendingTransferTag.findUnique({
    where: { id: tagId },
    select: { id: true, status: true },
  });
  if (!tag) return null;
  if (tag.status !== "por_confirmar") return { ok: false, tagId: tag.id };
  await prisma.pendingTransferTag.update({
    where: { id: tag.id },
    data: { concepto, status: "esperando" },
  });
  return { ok: true, tagId: tag.id };
}

export type ResultadoResolucion =
  | { tipo: "aplicada"; candidato: TraspasoCandidato; resultado: ResultadoEtiquetado }
  | { tipo: "en_espera" }
  | { tipo: "ambiguo"; candidatos: TraspasoCandidato[] };

/**
 * Intenta resolver una etiqueta ya completa (con obra y concepto):
 *
 *   - 0 candidatos  → el traspaso todavía no llegó del banco: queda esperando.
 *   - 1 candidato   → se etiqueta al toque y la etiqueta pasa a "aplicada".
 *   - 2 o más       → NO elegimos. Devolvemos los candidatos para que el bot
 *                     le pregunte a MJ cuál es.
 */
export async function resolverEtiqueta(
  tagId: string
): Promise<ResultadoResolucion | null> {
  const tag = await prisma.pendingTransferTag.findUnique({
    where: { id: tagId },
    select: {
      id: true,
      transferDate: true,
      amount: true,
      projectId: true,
      concepto: true,
      status: true,
    },
  });
  if (!tag || !tag.concepto) return null;

  const candidatos = await buscarTraspasosPorFechaMonto(
    tag.transferDate,
    tag.amount
  );
  if (candidatos.length === 0) return { tipo: "en_espera" };
  if (candidatos.length > 1) return { tipo: "ambiguo", candidatos };

  const resultado = await aplicarEtiquetaACandidato(tag.id, candidatos[0]);
  return { tipo: "aplicada", candidato: candidatos[0], resultado };
}

/**
 * Aplica una etiqueta a un traspaso concreto y la marca "aplicada". Se usa
 * cuando hay un solo candidato y cuando MJ eligió uno entre varios.
 */
export async function aplicarEtiquetaACandidato(
  tagId: string,
  candidato: TraspasoCandidato
): Promise<ResultadoEtiquetado> {
  const tag = await prisma.pendingTransferTag.findUniqueOrThrow({
    where: { id: tagId },
    select: { projectId: true, concepto: true },
  });
  const resultado = await etiquetarTraspasoSinPisar(
    candidato,
    tag.projectId,
    tag.concepto as ConceptoTraspaso
  );
  await prisma.pendingTransferTag.update({
    where: { id: tagId },
    data: {
      status: "aplicada",
      appliedToMovementId: candidato.id,
      appliedAt: new Date(),
    },
  });
  return resultado;
}

/** Trae una etiqueta con el nombre de la obra, para armar los mensajes. */
export async function getPendingTransferTag(tagId: string) {
  return prisma.pendingTransferTag.findUnique({
    where: { id: tagId },
    include: { project: { select: { name: true } } },
  });
}

/**
 * Aplica las etiquetas en espera que le calcen a un traspaso recién detectado
 * al importar la cartola. Se llama desde /api/banco/import, justo después de
 * linkear los dos lados del par.
 *
 * Solo aplica cuando la etiqueta calza con UN solo traspaso — si el mismo
 * monto y fecha calzara con dos, no adivinamos (queda "esperando" y MJ lo
 * resuelve a mano en la app).
 *
 * Devuelve cuántas etiquetas se aplicaron (0 en el caso normal, 1 cuando MJ
 * había mandado el comprobante por el bot).
 */
export async function applyPendingTransferTagsForMovement(
  movementId: string
): Promise<number> {
  const mov = await prisma.bankMovement.findUnique({
    where: { id: movementId },
    select: { id: true, date: true, amount: true, category: true },
  });
  if (!mov || mov.category !== "transfer_interno") return 0;

  const objetivo = Math.round(Math.abs(mov.amount));
  const desde = new Date(mov.date);
  desde.setUTCDate(desde.getUTCDate() - VENTANA_DIAS);
  const hasta = new Date(mov.date);
  hasta.setUTCDate(hasta.getUTCDate() + VENTANA_DIAS);
  hasta.setUTCHours(23, 59, 59, 999);

  // Solo las etiquetas COMPLETAS. Una "por_confirmar" (a la que le falta el
  // concepto) espera el botón de MJ; no se aplica sola.
  const tags = await prisma.pendingTransferTag.findMany({
    where: { status: "esperando", transferDate: { gte: desde, lte: hasta } },
    select: { id: true, amount: true },
  });

  let aplicadas = 0;
  for (const tag of tags) {
    if (Math.round(Math.abs(tag.amount)) !== objetivo) continue;

    // La etiqueta podría calzar con más de un traspaso (no pasó nunca en la
    // historia real, pero si pasara preferimos dejarla esperando antes que
    // imputar la obra equivocada — MJ la resuelve a mano en la app).
    const candidatos = await buscarTraspasosPorFechaMonto(mov.date, mov.amount);
    if (candidatos.length !== 1) continue;

    await aplicarEtiquetaACandidato(tag.id, candidatos[0]);
    aplicadas++;
  }
  return aplicadas;
}
