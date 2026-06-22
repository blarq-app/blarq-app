// Fondo Sueldos visto como FORMA DE PAGO del cliente.
//
// MJ (2026-06-22): la tarjeta del fondo tiene que leerse como un plan. De
// izquierda a derecha: la obra con su GG (% del costo directo), el costo
// directo, y la "utilidad a generar" (= el GG, lo que se traspasa a sueldos).
// Abajo, el desglose por la FORMA DE PAGO del cliente tal como está en el
// presupuesto aprobado (anticipo / avances / saldo), con el monto que se cobra
// en cada tramo y la utilidad que ese tramo genera. Cada tramo se marca como
// cobrado / parcial / pendiente según lo realmente cobrado.
//
// OJO terminología: "Estado de Pago" (modelo EstadoPago) son los pagos a los
// MAESTROS — NO es esto. Esto es la FORMA DE PAGO del cliente (modelo
// PaymentTerm sobre la versión de presupuesto).
//
// Módulo SOLO LECTURA y ADITIVO: no toca fondoSueldos.ts ni metrics.ts. El
// "cobrado" usa el mismo criterio que fondoSueldos.ts pero SOLO sobre facturas
// emitidas (las recibidas no son cobros del cliente), así que el número es el
// correcto — a diferencia del cálculo viejo de la card, que recibía todas las
// facturas y lo inflaba.

// ── Tipos de entrada (estructuralmente compatibles con el include del resumen) ──
type ObraItemLite = { total: number };
type MuebleItemLite = {
  quantity: number;
  costDistributor: number;
  clientPriceNet: number;
  clientPriceIva: number;
};
type PaymentTermLite = { stage: string; percentage: number; sortOrder: number };
type BudgetVersionLite = {
  type: string;
  status: string;
  ggPercentage: number | null;
  utilityPercentage: number | null;
  createdAt: Date;
  obraItems: ObraItemLite[];
  muebleChapters: { items: MuebleItemLite[] }[];
  paymentTerms: PaymentTermLite[];
  artefactoItems?: unknown[];
};
type InvoiceLite = {
  type: string;
  tipoDoc: number | null;
  totalAmount: number;
  conceptoCobro: string | null;
  status: string;
  payments: { amountApplied: number }[];
};
export type ProjectForFormaPago = {
  budgetVersions: BudgetVersionLite[];
  invoices: InvoiceLite[];
};

// ── Tipos de salida ─────────────────────────────────────────────────────────
export type TramoFormaPago = {
  stage: string;
  label: string;
  percentage: number;
  montoACobrar: number; // % × total acordado obra (lo que paga el cliente)
  utilidadGenera: number; // % × GG obra (lo que se traspasa a sueldos)
  estado: "cobrado" | "parcial" | "pendiente";
};

export type FormaPagoFondo = {
  // Resumen por tipo
  obraCD: number;
  obraGGTotal: number;
  obraGGPercentage: number;
  obraTotalAcordado: number;
  mueblesCD: number; // costo (lo que paga BLARQ al proveedor)
  mueblesUtil: number; // utilidad neta estimada
  mueblesTotalAcordado: number;
  artefactosPresente: boolean;
  totalUtilidadAGenerar: number; // obraGGTotal + mueblesUtil

  // Forma de pago (obra)
  tramos: TramoFormaPago[];
  hayFormaPago: boolean;
  tramosDesdeAprobada: boolean; // false = se tomaron de otra versión (fallback)

  // Cobrado / generado correcto (solo emitidas)
  obraCobradoCIVA: number;
  mueblesCobradoCIVA: number;
  generadoHastaAhora: number;
};

// Mismo criterio de "cobrado" que fondoSueldos.ts.
function cobradoDe(inv: InvoiceLite): number {
  if (inv.payments.length > 0) {
    return inv.payments.reduce((s, p) => s + p.amountApplied, 0);
  }
  return inv.status === "pagada" ? inv.totalAmount : 0;
}

function bestVersion<T extends { status: string; createdAt: Date }>(arr: T[]): T | undefined {
  const aprobado = arr
    .filter((b) => b.status === "aprobado")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return aprobado ?? arr.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
}

// "anticipo" → "Anticipo"; "avance1" → "Avance 1"; "saldo" → "Saldo".
function labelTramo(stage: string): string {
  const m = stage.match(/^avance\s*(\d+)$/i);
  if (m) return `Avance ${m[1]}`;
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}

export function computeFormaPagoFondo(p: ProjectForFormaPago): FormaPagoFondo {
  // ── OBRA: GG / costo directo / total acordado sobre TODAS las aprobadas ──
  // (igual que metrics.ts y utilidadPorCobro.ts — soporta anexos/adicionales).
  const obrasAprobadas = p.budgetVersions.filter(
    (b) => b.type === "obra" && b.status === "aprobado"
  );
  let obraCD = 0;
  let obraGGTotal = 0;
  let obraTotalAcordado = 0;
  for (const o of obrasAprobadas) {
    const cd = o.obraItems.reduce((s, i) => s + i.total, 0);
    const ggPct = (o.ggPercentage ?? 0) / 100;
    const utilPct = (o.utilityPercentage ?? 0) / 100;
    obraCD += cd;
    obraGGTotal += cd * ggPct;
    obraTotalAcordado += cd * (1 + ggPct) * (1 + utilPct) * 1.19;
  }
  const tasaUtilidadObra = obraTotalAcordado > 0 ? obraGGTotal / obraTotalAcordado : 0;
  // % de GG para el rótulo ("GG 20% del costo directo"): el de la obra aprobada
  // de mayor costo directo (si hay anexos con % distinto, manda la principal).
  const obraPrincipal = [...obrasAprobadas].sort(
    (a, b) =>
      b.obraItems.reduce((s, i) => s + i.total, 0) -
      a.obraItems.reduce((s, i) => s + i.total, 0)
  )[0];
  const obraGGPercentage = obraPrincipal?.ggPercentage ?? 0;

  // ── MUEBLES: costo, utilidad estimada, total acordado (mejor versión) ───
  const muebles = bestVersion(p.budgetVersions.filter((b) => b.type === "muebles"));
  const muebleItems = muebles ? muebles.muebleChapters.flatMap((c) => c.items) : [];
  const mueblesCD = muebleItems.reduce((s, i) => s + i.costDistributor * i.quantity, 0);
  const mueblesUtil = muebleItems.reduce(
    (s, i) => s + (i.clientPriceNet - i.costDistributor) * i.quantity,
    0
  );
  const mueblesTotalAcordado = muebleItems.reduce(
    (s, i) => s + i.clientPriceIva * i.quantity,
    0
  );
  const tasaUtilidadMuebles =
    mueblesTotalAcordado > 0 ? mueblesUtil / mueblesTotalAcordado : 0;

  const artefactosPresente = p.budgetVersions.some(
    (b) => b.type === "artefactos" && (b.artefactoItems?.length ?? 0) > 0
  );

  // ── Cobrado (solo emitidas, por concepto) ───────────────────────────────
  let obraCobradoCIVA = 0;
  let mueblesCobradoCIVA = 0;
  for (const inv of p.invoices) {
    if (inv.type !== "emitida") continue;
    const sign = inv.tipoDoc === 61 ? -1 : 1; // NC resta
    const cobrado = sign * cobradoDe(inv);
    if (cobrado === 0) continue;
    const concepto = inv.conceptoCobro ?? "obra";
    if (concepto === "muebles") mueblesCobradoCIVA += cobrado;
    else if (concepto === "obra") obraCobradoCIVA += cobrado;
  }

  const generadoHastaAhora =
    Math.min(obraGGTotal, obraCobradoCIVA * tasaUtilidadObra) +
    Math.min(mueblesUtil, mueblesCobradoCIVA * tasaUtilidadMuebles);

  // ── Forma de pago del cliente (obra) ────────────────────────────────────
  // Preferimos la versión APROBADA que tenga forma de pago cargada; si la
  // aprobada no la tiene (caso JNC: está en la enviada), caemos a la versión
  // de obra más reciente que sí la tenga, y lo marcamos (tramosDesdeAprobada).
  const obraConTerms = p.budgetVersions.filter(
    (b) => b.type === "obra" && b.paymentTerms.length > 0
  );
  const aprobadaConTerms = obraConTerms
    .filter((b) => b.status === "aprobado")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const fuenteTerms =
    aprobadaConTerms ??
    [...obraConTerms].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const tramosDesdeAprobada = !!aprobadaConTerms;

  const terms = fuenteTerms
    ? [...fuenteTerms.paymentTerms].sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  // Marcado cobrado/parcial/pendiente: caminamos los tramos acumulando el monto
  // a cobrar y lo comparamos contra lo realmente cobrado de obra. Tolerancia de
  // $1.000 para no marcar "parcial" por redondeos de IVA.
  const TOL = 1000;
  let acum = 0;
  const tramos: TramoFormaPago[] = terms.map((t) => {
    const pct = t.percentage / 100;
    const montoACobrar = pct * obraTotalAcordado;
    const utilidadGenera = pct * obraGGTotal;
    const inicio = acum;
    const fin = acum + montoACobrar;
    acum = fin;
    let estado: TramoFormaPago["estado"];
    if (obraCobradoCIVA >= fin - TOL) estado = "cobrado";
    else if (obraCobradoCIVA > inicio + TOL) estado = "parcial";
    else estado = "pendiente";
    return {
      stage: t.stage,
      label: labelTramo(t.stage),
      percentage: t.percentage,
      montoACobrar,
      utilidadGenera,
      estado,
    };
  });

  return {
    obraCD,
    obraGGTotal,
    obraGGPercentage,
    obraTotalAcordado,
    mueblesCD,
    mueblesUtil,
    mueblesTotalAcordado,
    artefactosPresente,
    totalUtilidadAGenerar: obraGGTotal + mueblesUtil,
    tramos,
    hayFormaPago: tramos.length > 0,
    tramosDesdeAprobada,
    obraCobradoCIVA,
    mueblesCobradoCIVA,
    generadoHastaAhora,
  };
}
