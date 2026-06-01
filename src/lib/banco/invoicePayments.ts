// Helpers para manejar imputaciones movimiento↔factura (InvoicePayment).
//
// Una factura puede recibir cobros parciales (varios movimientos) y un
// movimiento puede aplicarse a varias facturas. La fuente de verdad del
// "cuánto está cobrado" de una factura es Σ(InvoicePayment.amountApplied)
// para esa factura — el campo Invoice.status es derivado.

import { prisma } from "@/lib/prisma";

/**
 * Recalcula el `status` y `paidAt` de una factura a partir de sus
 * InvoicePayment. Llamar después de crear/borrar/modificar pagos.
 *
 *   pendiente : 0 imputado
 *   parcial   : 0 < imputado < totalAmount
 *   pagada    : imputado >= totalAmount   (paidAt = max(date) de los movs)
 *
 * Tolera $1 de redondeo (CLP no tiene decimales pero la API devuelve floats).
 */
export async function recomputeInvoiceStatus(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { totalAmount: true, status: true },
  });
  if (!invoice) return;

  // status="anulada" no se toca — anulación es manual, no derivada.
  if (invoice.status === "anulada") return;

  const payments = await prisma.invoicePayment.findMany({
    where: { invoiceId },
    select: {
      amountApplied: true,
      bankMovement: { select: { date: true } },
    },
  });

  const sumApplied = payments.reduce((s, p) => s + p.amountApplied, 0);

  let nextStatus: "pendiente" | "parcial" | "pagada" = "pendiente";
  let paidAt: Date | null = null;

  if (sumApplied >= invoice.totalAmount - 1) {
    nextStatus = "pagada";
    // paidAt = fecha del último movimiento que cerró la factura.
    paidAt = payments.reduce<Date | null>((latest, p) => {
      const d = p.bankMovement.date;
      return !latest || d > latest ? d : latest;
    }, null);
  } else if (sumApplied > 0) {
    nextStatus = "parcial";
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: nextStatus, paidAt },
  });
}

/**
 * Devuelve cuánto del monto de un movimiento bancario ya está imputado
 * a facturas (suma de InvoicePayment.amountApplied para ese mov).
 * Útil para validar antes de asignar más imputaciones.
 */
export async function getMovementAppliedAmount(bankMovementId: string): Promise<number> {
  const r = await prisma.invoicePayment.aggregate({
    where: { bankMovementId },
    _sum: { amountApplied: true },
  });
  return r._sum.amountApplied ?? 0;
}

/**
 * Idem para una factura: cuánto está cobrado a la fecha.
 */
export async function getInvoicePaidAmount(invoiceId: string): Promise<number> {
  const r = await prisma.invoicePayment.aggregate({
    where: { invoiceId },
    _sum: { amountApplied: true },
  });
  return r._sum.amountApplied ?? 0;
}

/**
 * Auto-conciliación al emitir una factura nueva: busca movimientos
 * bancarios sin asignar del mismo RUT contraparte que matcheen el
 * monto exacto (caso típico MJ: te pagan, después emitís factura).
 *
 * Heurística conservadora — solo aplica si hay un único mov candidato:
 *   - mismo type opuesto (factura emitida → busca abono; recibida → cargo)
 *   - mismo RUT contraparte
 *   - status sin_asignar (no parcial todavía, evita pisar imputaciones)
 *   - |amount| coincide ±$10 con totalAmount
 *
 * Si encuentra exactamente un match, crea el InvoicePayment y actualiza
 * status del mov a "conciliado" + status de la factura a "pagada".
 *
 * Si hay 0 o múltiples candidatos, no toca nada — MJ resuelve manual.
 *
 * Devuelve cuántos movs auto-vinculó (0 o 1).
 */
/**
 * Dado el RUT de una empresa (la que emite la factura), devuelve las
 * señales para encontrar los movimientos del reembolsador asociado:
 * las glosas (para buscar en description) y los personRut (para buscar
 * en counterpartyRut). Caso: factura de "JPB" (RUT empresa) pagada por
 * transferencias a "Jose Perez" — el link lo da el alias del reembolsador.
 *
 * El personRut es la señal más confiable; la glosa es respaldo.
 */
async function reembolsadorSignalsForAliasRut(
  rutDigits: string
): Promise<{ glosas: string[]; personRuts: string[] }> {
  if (rutDigits.length < 7) return { glosas: [], personRuts: [] };
  const reembolsadores = await prisma.reembolsador.findMany({
    select: {
      glosa: true,
      personRut: true,
      aliases: { select: { rut: true } },
    },
  });
  const tail = rutDigits.slice(-8);
  const glosas = new Set<string>();
  const personRuts = new Set<string>();
  for (const r of reembolsadores) {
    const hasAlias = r.aliases.some((a) => {
      const aDigits = a.rut.replace(/\D/g, "");
      return aDigits.length > 0 && (aDigits.includes(tail) || tail.includes(aDigits));
    });
    if (hasAlias) {
      glosas.add(r.glosa.toLowerCase());
      const pr = (r.personRut ?? "").replace(/\D/g, "");
      if (pr.length > 0) personRuts.add(pr.slice(-8));
    }
  }
  return { glosas: [...glosas], personRuts: [...personRuts] };
}

/**
 * Inverso: dado un movimiento (su descripción y su counterpartyRut),
 * devuelve los RUTs (dígitos, últimos 8) de los aliases de los
 * reembolsadores que matchean ese mov — por personRut (preferido) o por
 * glosa (respaldo). Caso: mov "Transf a Jose Perez" → RUT de JPB.
 */
// Forma de un reembolsador ya cargado, para poder pasarlo precargado y no
// re-consultar la BD por cada movimiento (ver auto-conciliar masivo).
type ReembolsadorLite = {
  glosa: string;
  personRut: string | null;
  aliases: { rut: string }[];
};

// Versión PURA: recibe los reembolsadores ya cargados. La lógica es idéntica
// a aliasRutsForMovement, solo que no consulta la BD. La usa el batch para
// cargar los reembolsadores UNA vez en vez de 1 por movimiento (era el cuello
// de botella del endpoint masivo: ~200 consultas idénticas).
function aliasRutsFromList(
  description: string,
  counterpartyRut: string | null,
  reembolsadores: ReembolsadorLite[]
): string[] {
  const desc = (description ?? "").toLowerCase();
  const movRut = (counterpartyRut ?? "").replace(/\D/g, "");
  if (!desc && !movRut) return [];
  const ruts = new Set<string>();
  for (const r of reembolsadores) {
    const pr = (r.personRut ?? "").replace(/\D/g, "");
    const matchByRut =
      pr.length > 0 && movRut && (pr.includes(movRut) || movRut.includes(pr));
    const matchByGlosa = desc.includes(r.glosa.toLowerCase());
    if (matchByRut || matchByGlosa) {
      for (const a of r.aliases) {
        const d = a.rut.replace(/\D/g, "");
        if (d.length > 0) ruts.add(d.slice(-8));
      }
    }
  }
  return [...ruts];
}

// Carga los reembolsadores (glosa + RUT + aliases) una sola vez. Útil para
// procesar muchos movimientos sin repetir la query.
export async function loadReembolsadores(): Promise<ReembolsadorLite[]> {
  return prisma.reembolsador.findMany({
    select: { glosa: true, personRut: true, aliases: { select: { rut: true } } },
  });
}

async function aliasRutsForMovement(
  description: string,
  counterpartyRut: string | null,
  reembolsadores?: ReembolsadorLite[]
): Promise<string[]> {
  const list = reembolsadores ?? (await loadReembolsadores());
  return aliasRutsFromList(description, counterpartyRut, list);
}

export async function tryAutoMatchInvoiceWithExistingMovs(invoiceId: string): Promise<number> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      type: true,
      tipoDoc: true,
      totalAmount: true,
      status: true,
      rutIssuer: true,
      rutReceiver: true,
      businessName: true,
      issueDate: true,
      payments: { select: { id: true } },
    },
  });
  if (!inv) return 0;
  // Si la factura ya tiene pagos o no está pendiente, no tocar.
  if (inv.payments.length > 0 || inv.status !== "pendiente") return 0;
  // NCs no se "pagan" auto.
  if (inv.tipoDoc === 61) return 0;

  // Para emitidas, contraparte = cliente = rutReceiver (el cliente de BLARQ).
  // Para recibidas, contraparte = proveedor = rutIssuer.
  const counterpartyRut = inv.type === "emitida" ? inv.rutReceiver : inv.rutIssuer;
  if (!counterpartyRut) return 0;
  const counterpartyDigits = counterpartyRut.replace(/\D/g, "");
  if (counterpartyDigits.length < 7) return 0;

  // Filtro de monto según el lado del mov (cargo para recibida, abono
  // para emitida). Se reutiliza en las dos búsquedas de candidatos.
  const amountWhere =
    inv.type === "emitida"
      ? { amount: { gte: inv.totalAmount - 10, lte: inv.totalAmount + 10 } }
      : { amount: { gte: -(inv.totalAmount + 10), lte: -(inv.totalAmount - 10) } };

  // Candidatos por RUT directo: movs cuya contraparte es el mismo RUT
  // de la factura (caso normal — pago directo al proveedor/cliente).
  const byRut = await prisma.bankMovement.findMany({
    where: {
      status: "sin_asignar",
      counterpartyRut: { contains: counterpartyDigits.slice(-8) },
      ...amountWhere,
    },
    select: { id: true, amount: true, date: true },
    take: 5,
  });

  // Candidatos por reembolsador: si la factura es de una empresa (JPB)
  // cuyo RUT está como alias de un reembolsador (Jose Perez), también
  // consideramos movs de ese reembolsador — match por personRut (RUT de
  // la persona en la transferencia, preferido) o por glosa (respaldo).
  const { glosas, personRuts } = await reembolsadorSignalsForAliasRut(
    counterpartyDigits
  );
  let byAlias: { id: string; amount: number; date: Date }[] = [];
  const orSignals: Record<string, unknown>[] = [
    ...personRuts.map((pr) => ({ counterpartyRut: { contains: pr } })),
    ...glosas.map((g) => ({
      description: { contains: g, mode: "insensitive" as const },
    })),
  ];
  if (orSignals.length > 0) {
    byAlias = await prisma.bankMovement.findMany({
      where: { status: "sin_asignar", OR: orSignals, ...amountWhere },
      select: { id: true, amount: true, date: true },
      take: 5,
    });
  }

  // Candidatos por COMERCIO: las compras con tarjeta no traen RUT, así que
  // byRut/byAlias nunca las encuentran. Para una factura recibida de un
  // comercio conocido (Sodimac, Easy, Sherwin/Vespucio...), buscamos movs
  // sin asignar del mismo monto cuya glosa nombre ese comercio, dentro de la
  // ventana de fecha (la boleta de tarjeta es del mismo día). Simétrico al
  // match por comercio del camino movimiento→factura.
  let byMerchant: { id: string; amount: number; date: Date }[] = [];
  const invMerchant = inv.type === "recibida" ? merchantFromName(inv.businessName) : null;
  if (invMerchant) {
    const sameAmount = await prisma.bankMovement.findMany({
      where: { status: "sin_asignar", ...amountWhere },
      select: { id: true, amount: true, date: true, description: true },
      take: 20,
    });
    const issueT = new Date(inv.issueDate).getTime();
    byMerchant = sameAmount
      .filter((m) => merchantFromGlosa(m.description) === invMerchant)
      .filter(
        (m) =>
          Math.abs(issueT - new Date(m.date).getTime()) / 86400000 <=
          MERCHANT_DATE_WINDOW_DAYS
      )
      .map((m) => ({ id: m.id, amount: m.amount, date: m.date }));
  }

  // Unimos por id (un mov puede caer en varias listas).
  const byId = new Map<string, { id: string; amount: number; date: Date }>();
  for (const m of [...byRut, ...byAlias, ...byMerchant]) byId.set(m.id, m);
  const candidates = [...byId.values()];

  // Solo auto-conciliamos si hay UN único candidato — si hay varios, es
  // ambiguo y lo dejamos para decisión manual.
  if (candidates.length !== 1) return 0;

  const mov = candidates[0];
  await prisma.invoicePayment.create({
    data: {
      bankMovementId: mov.id,
      invoiceId: inv.id,
      amountApplied: Math.abs(mov.amount),
      autoMatched: true, // creada por el auto-match
    },
  });
  await prisma.bankMovement.update({
    where: { id: mov.id },
    data: { status: "conciliado" },
  });
  await recomputeInvoiceStatus(inv.id);
  return 1;
}

/**
 * DECISIÓN PURA del match mov→factura (sin BD, testeable). Dadas las
 * facturas candidatas (ya filtradas por monto/saldo) y los RUTs del
 * movimiento, decide cuál factura corresponde validando el RUT.
 *
 * Criterio conservador (ADR 2026-05-30): el RUT de la contraparte DEBE
 * calzar con el de la factura — directo o vía alias de reembolsador
 * (persona→empresa). La fecha NO interviene (no filtra ni desempata acá).
 * Si no hay RUT con qué validar, o el match es ambiguo, NO concilia.
 *
 *   - sin RUT del mov ni alias        → "no_rut_to_validate"
 *   - ninguna candidata calza el RUT  → "no_rut_match"
 *   - más de una calza                → "ambiguous_multi"
 *   - exactamente una                 → { invoiceId }
 */
export type MovInvoiceMatchReason =
  | "no_rut_to_validate" // no hay RUT ni comercio reconocible con qué validar
  | "no_rut_match" // hay RUT pero ninguna candidata calza
  | "ambiguous_multi" // varias candidatas calzan el RUT
  | "no_merchant_match" // comercio reconocido pero ninguna factura de ese comercio
  | "merchant_out_of_window" // hay factura del comercio+monto pero la fecha está muy lejos (¿otra compra?)
  | "ambiguous_merchant"; // varias facturas del mismo comercio + monto dentro de la ventana

// Ventana de fecha para el match por comercio (compras con tarjeta). En una
// compra con tarjeta la boleta/factura se emite el mismo día (±unos días por
// desfase de registro del banco). Si la única factura del mismo comercio+monto
// está a más de esto, casi seguro es OTRA compra que coincide en monto — no se
// concilia. OJO: esta ventana es SOLO para el camino por comercio; el camino
// por RUT (transferencias a maestros, que facturan después) no usa fecha.
const MERCHANT_DATE_WINDOW_DAYS = 31;

// Comercios conocidos para el match de COMPRAS CON TARJETA (que no traen RUT).
// Cada uno con un patrón para la glosa del banco y otro para la razón social
// de la factura — a veces difieren (el local Sherwin factura como "Vespucio
// Oriente"; Homecenter es marca de Sodimac).
//
// A PROPÓSITO no incluye MercadoLibre/MercadoPago: la factura suele venir de
// la tienda vendedora, no de MercadoLibre, así que matchear por ese nombre
// daría falsos positivos (ADR 2026-05-30). Esas quedan pendientes.
const TARJETA_MERCHANTS: { id: string; glosa: RegExp; name: RegExp }[] = [
  { id: "sodimac", glosa: /sodimac|homecenter/, name: /sodimac|homecenter/ },
  { id: "easy", glosa: /\beasy\b/, name: /easy/ },
  { id: "cavem", glosa: /cavem/, name: /cavem/ },
  { id: "sherwin", glosa: /sherwin|vespucio oriente/, name: /sherwin/ },
  { id: "construmart", glosa: /construmart/, name: /construmart/ },
  { id: "imperial", glosa: /imperial/, name: /imperial/ },
  { id: "tottus", glosa: /tottus/, name: /tottus/ },
  { id: "copec", glosa: /copec/, name: /copec/ },
];
const normTxt = (s: string | null) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
function merchantFromGlosa(desc: string | null): string | null {
  const t = normTxt(desc);
  return TARJETA_MERCHANTS.find((m) => m.glosa.test(t))?.id ?? null;
}
function merchantFromName(name: string | null): string | null {
  const t = normTxt(name);
  return TARJETA_MERCHANTS.find((m) => m.name.test(t))?.id ?? null;
}

export function decideMovementInvoiceMatch(args: {
  candidates: { id: string; rutIssuer: string | null; rutReceiver: string | null; businessName: string | null; issueDate: Date | string }[];
  isCargo: boolean; // true = cargo (recibida, RUT del emisor); false = abono (emitida, RUT del receptor)
  movRutDigits: string; // dígitos de counterpartyRut del banco ("" si no hay)
  aliasRutDigits: string[]; // últimos 8 dígitos de los aliases de reembolsador que matchean el mov
  movDescription: string; // glosa del banco — para match por comercio cuando no hay RUT
  movDate: Date | string; // fecha del movimiento — ventana de fecha en el camino por comercio
}): { invoiceId: string } | { reason: MovInvoiceMatchReason } {
  const { candidates, isCargo, movRutDigits, aliasRutDigits, movDescription, movDate } = args;

  // CAMINO A — hay RUT (del mov o vía alias de reembolsador): validar por RUT.
  // Es la señal fuerte; si hay RUT y no calza, NO se cae al match por comercio
  // (un RUT que no cuadra es indicio claro de que es otra factura).
  if (movRutDigits || aliasRutDigits.length > 0) {
    const isRutValid = (c: { rutIssuer: string | null; rutReceiver: string | null }) => {
      const cRut = (isCargo ? c.rutIssuer : c.rutReceiver) ?? "";
      const cRutDigits = cRut.replace(/\D/g, "");
      if (cRutDigits.length === 0) return false;
      if (movRutDigits && (movRutDigits.includes(cRutDigits) || cRutDigits.includes(movRutDigits))) {
        return true;
      }
      return aliasRutDigits.some((a) => a.includes(cRutDigits) || cRutDigits.includes(a));
    };
    const filtered = candidates.filter(isRutValid);
    if (filtered.length === 0) return { reason: "no_rut_match" };
    if (filtered.length > 1) return { reason: "ambiguous_multi" };
    return { invoiceId: filtered[0].id };
  }

  // CAMINO B — compra con tarjeta (sin RUT): match por nombre de comercio,
  // con ventana de fecha. Solo concilia si el comercio de la glosa es conocido,
  // el comercio de la factura calza, la fecha está dentro de la ventana y hay
  // EXACTAMENTE una candidata así (+monto, ya filtrado afuera).
  const merchant = merchantFromGlosa(movDescription);
  if (!merchant) return { reason: "no_rut_to_validate" }; // comercio no reconocido → manual
  const byMerchant = candidates.filter((c) => merchantFromName(c.businessName) === merchant);
  if (byMerchant.length === 0) return { reason: "no_merchant_match" };
  const dayMs = 86400000;
  const movT = new Date(movDate).getTime();
  const withinWindow = byMerchant.filter(
    (c) => Math.abs(movT - new Date(c.issueDate).getTime()) / dayMs <= MERCHANT_DATE_WINDOW_DAYS
  );
  // Hay factura del comercio+monto pero ninguna cerca en fecha → probablemente
  // es otra compra del mismo monto. No conciliar (queda para revisión manual).
  if (withinWindow.length === 0) return { reason: "merchant_out_of_window" };
  if (withinWindow.length > 1) return { reason: "ambiguous_merchant" };
  return { invoiceId: withinWindow[0].id };
}

/**
 * Auto-match en la dirección movimiento → factura.
 *
 * Busca facturas pendientes/parciales con saldo restante ±$10 al monto
 * del movimiento y delega la decisión en `decideMovementInvoiceMatch`
 * (valida RUT, no usa fecha). Si encuentra match único, crea el
 * InvoicePayment y actualiza status. Devuelve { matched, invoiceId } o
 * { matched: false, reason }.
 *
 * Es la ÚNICA fuente de verdad del auto-match mov→factura: la usan el
 * endpoint de "Auto-conciliar pendientes", el sync SII y el importador de
 * cartolas (/api/banco/import).
 */
// Factura candidata ya cargada con sus pagos, para el camino batch (precarga
// una vez en vez de consultar por cada movimiento — ver loadCandidateInvoices).
export type CandidateInvoice = {
  id: string;
  type: string;
  rutIssuer: string | null;
  rutReceiver: string | null;
  businessName: string | null;
  issueDate: Date;
  totalAmount: number;
  tipoDoc: number | null;
  payments: { amountApplied: number }[];
};

// Carga TODAS las facturas pendientes/parciales (recibidas y emitidas) con
// sus pagos, de una sola vez. El batch la llama una vez y filtra en memoria
// por monto/tipo para cada movimiento, en lugar de hacer una query
// invoice.findMany por movimiento (era el cuello de botella real: ~440ms ×
// N movimientos). NC (tipoDoc 61) se excluyen, igual que en la query original.
export async function loadCandidateInvoices(): Promise<CandidateInvoice[]> {
  return prisma.invoice.findMany({
    where: {
      status: { in: ["pendiente", "parcial"] },
      tipoDoc: { not: 61 },
    },
    select: {
      id: true,
      type: true,
      rutIssuer: true,
      rutReceiver: true,
      businessName: true,
      issueDate: true,
      totalAmount: true,
      tipoDoc: true,
      payments: { select: { amountApplied: true } },
    },
  });
}

export async function tryAutoMatchMovementWithInvoices(
  movId: string,
  // Reembolsadores precargados (opcional). Cuando se procesan muchos
  // movimientos en lote, pasarlos evita re-consultar la BD por cada uno.
  reembolsadores?: ReembolsadorLite[],
  // Facturas candidatas precargadas (opcional, para el batch). Si viene, se
  // filtra en memoria en lugar de consultar la BD. excludeInvoiceIds son las
  // facturas ya consumidas en esta corrida (la lista en memoria no refleja
  // los pagos creados durante el propio batch, así que las excluimos a mano
  // para no imputar dos movimientos a la misma factura).
  preloaded?: {
    invoices: CandidateInvoice[];
    excludeInvoiceIds: Set<string>;
    // Movimiento ya cargado (con sus pagos). Evita el findUnique por mov —
    // el otro cuello de botella del batch (cientos de viajes a la BD remota).
    // El batch los trae todos en UNA query y los pasa de a uno.
    movement?: {
      id: string;
      amount: number;
      status: string;
      description: string;
      counterpartyRut: string | null;
      date: Date;
      payments: { id: string }[];
    };
  }
): Promise<{ matched: boolean; invoiceId?: string; reason?: string }> {
  const mov =
    preloaded?.movement ??
    (await prisma.bankMovement.findUnique({
      where: { id: movId },
      include: { payments: true },
    }));
  if (!mov) return { matched: false, reason: "mov_not_found" };
  if (mov.status === "interno") return { matched: false, reason: "interno" };
  if (mov.payments.length > 0) return { matched: false, reason: "already_has_payments" };

  const isCargo = mov.amount < 0;
  const targetType = isCargo ? "recibida" : "emitida";
  const absAmount = Math.abs(mov.amount);

  // Candidatas: de la lista precargada (batch) o consultando la BD (caso
  // suelto, ej. sync SII de una factura). El resultado es idéntico.
  let rawCandidates: CandidateInvoice[];
  if (preloaded) {
    rawCandidates = preloaded.invoices.filter(
      (c) =>
        c.type === targetType &&
        !preloaded.excludeInvoiceIds.has(c.id) &&
        c.totalAmount >= absAmount - 10
    );
  } else {
    rawCandidates = await prisma.invoice.findMany({
      where: {
        type: targetType,
        status: { in: ["pendiente", "parcial"] },
        tipoDoc: { not: 61 },
        totalAmount: { gte: absAmount - 10 },
      },
      select: {
        id: true,
        type: true,
        rutIssuer: true,
        rutReceiver: true,
        businessName: true,
        issueDate: true,
        totalAmount: true,
        tipoDoc: true,
        payments: { select: { amountApplied: true } },
      },
    });
  }

  const candidates = rawCandidates
    .map((c) => {
      const paid = c.payments.reduce((s, p) => s + p.amountApplied, 0);
      return { ...c, remaining: c.totalAmount - paid };
    })
    .filter((c) => c.remaining >= absAmount - 10 && c.remaining <= absAmount + 10);

  if (candidates.length === 0) return { matched: false, reason: "no_candidates" };

  // VALIDACIÓN DE RUT — siempre, incluso con UN solo candidato. Antes el
  // codigo ataba si habia 1 solo candidato sin chequear RUT (caso famoso:
  // Pedro Barrera persona ↔ Vidrios Rotos empresa, montos calzaban → la
  // app los unia ciegamente). La decisión vive en decideMovementInvoiceMatch
  // (pura, testeable): exige RUT directo o vía alias de reembolsador.
  const aliasRutDigits = await aliasRutsForMovement(
    mov.description,
    mov.counterpartyRut,
    reembolsadores
  );
  const movRutDigits = (mov.counterpartyRut ?? "").replace(/\D/g, "");

  const decision = decideMovementInvoiceMatch({
    candidates,
    isCargo,
    movRutDigits,
    aliasRutDigits,
    movDescription: mov.description,
    movDate: mov.date,
  });
  if ("reason" in decision) return { matched: false, reason: decision.reason };
  const match = candidates.find((c) => c.id === decision.invoiceId)!;

  await prisma.invoicePayment.create({
    data: {
      bankMovementId: mov.id,
      invoiceId: match.id,
      amountApplied: absAmount,
      autoMatched: true, // creada por el auto-match
    },
  });
  await prisma.bankMovement.update({
    where: { id: mov.id },
    data: { status: "conciliado" },
  });
  await recomputeInvoiceStatus(match.id);

  return { matched: true, invoiceId: match.id };
}
