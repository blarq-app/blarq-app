// Cálculo por concepto del Cuadro Resumen del proyecto — fuente única que
// comparten el `CuadroResumen` (vista) y la herramienta "Armar avance + Me
// paso a Sueldos". Antes este cálculo vivía inline en CuadroResumen.tsx; se
// extrajo acá para no duplicarlo (regla del repo: una sola fuente de verdad
// por cálculo).
//
// Por cada concepto (OBRA / ART. COCINA / ART. SANITARIOS / ART. ILUMINACIÓN /
// MUEBLES) calcula: el acordado (suma de versiones aprobadas), lo ya cobrado
// (transferencias conciliadas con facturas emitidas, repartiendo artefactos
// proporcional al acordado), el % de avance y el saldo. Además, para los
// conceptos que GENERAN sueldo (obra, muebles), la utilidad al 100% (GG obra /
// utilidad neta muebles) — base del cálculo de cuánto se traspasa a Sueldos.
//
// Reglas de negocio (ya confirmadas con MJ, ver CuadroResumen.tsx histórico):
//   - Acordado OBRA: CD × (1 + GG + Util) × 1.19  (GG/Util ADITIVOS, no encadenados).
//   - Acordado MUEBLES: Σ clientPriceIva × qty.
//   - Acordado ARTEFACTOS: split cocina/sanitarios/iluminación por subcategory.
//   - Sueldo lo generan OBRA (su GG) y MUEBLES (utilidad neta). Artefactos NO.

import { conceptoDeFactura, desgloseDeCobro } from "@/lib/invoices/conceptoCobro";
import { selectVigentes } from "@/lib/projects/selectVersion";

// ── Tipos de entrada (estructuralmente compatibles con el include del resumen) ──
// `noCobrado` es opcional en el tipo porque los callers arman el input con un
// include amplio (`obraItems: true`) y no todos los tests lo pasan; ausente se
// lee como false, que es el caso normal.
type ObraItemLite = { total: number; noCobrado?: boolean };
type MuebleItemLite = {
  quantity: number;
  costDistributor: number;
  clientPriceNet: number;
  clientPriceIva: number;
};
type ArtefactoItemLite = {
  subcategory: string;
  clientPrice: number;
  quantity: number;
};
type BudgetVersionLite = {
  version: string;
  status: string;
  type: string;
  createdAt: Date;
  updatedAt: Date;
  ggPercentage: number | null;
  utilityPercentage: number | null;
  obraItems?: ObraItemLite[];
  muebleChapters?: { items: MuebleItemLite[] }[];
  artefactoItems?: ArtefactoItemLite[];
};
type PaymentLite = { amountApplied: number; bankMovement: { date: Date } };
type InvoiceLite = {
  type: string;
  // Categoría que MJ asigna a la factura emitida (CostCategory "Obra" /
  // "Muebles" / "Artefactos", appliesTo="emitida"). ES la fuente de verdad
  // del concepto del cobro — el cuadro la lee de acá.
  category: { name: string } | null;
  // Campo legacy "obra | muebles | artefactos". Casi siempre null; se usa
  // solo como respaldo si una factura vieja no tiene categoría.
  conceptoCobro: string | null;
  folioNumber: string | null;
  totalAmount: number;
  // Desglose REAL del cobro entre los 5 conceptos (si está cargado). Los tres
  // de artefactos son los originales; montoObra y montoMuebles se agregaron
  // para las facturas COMBINADAS (ver desgloseDeCobro en conceptoCobro.ts).
  artefactoCocina: number | null;
  artefactoSanitario: number | null;
  artefactoIluminacion: number | null;
  montoObra?: number | null;
  montoMuebles?: number | null;
  payments: PaymentLite[];
};
export type CuadroResumenInput = {
  invoices: InvoiceLite[];
  budgets: BudgetVersionLite[];
};

// ── Tipos de salida ─────────────────────────────────────────────────────────
export type ConceptoKey = "obra" | "cocina" | "sanitarios" | "iluminacion" | "muebles";

export type ConceptoCuadro = {
  key: ConceptoKey;
  label: string;
  acordado: number;
  pagado: number; // total cobrado de este concepto
  avancePct: number; // pagado / acordado (0..1+)
  saldo: number; // acordado − pagado
  fecha: string; // fecha de la versión vigente del concepto (dd-mm-yy)
  generaSueldo: boolean; // obra y muebles = true
  utilidad100: number; // utilidad al 100% (GG obra / util neta muebles); 0 si no genera
};

// Una fila de pago = un AVANCE cobrado (todas las facturas de la misma fecha
// agrupadas), con el monto y la factura POR CONCEPTO. Antes había una fila por
// factura (obra/artefactos/muebles en filas separadas); ahora van juntas en la
// fila de su fecha, como en el Excel de MJ.
export type PagoRow = {
  date: Date;
  porConcepto: Record<ConceptoKey, { monto: number; folio: string | null }>;
};

export type CuadroResumenData = {
  conceptos: ConceptoCuadro[]; // solo los que tienen acordado > 0
  pagos: PagoRow[];
  totalAcordado: number;
  totalPagado: number;
  saldoTotal: number;
  avanceTotal: number; // totalPagado / totalAcordado
  versionLabel: string; // "V5" / "V6" / "Acordado" (si hay 2+ aprobadas por tipo)
};

function lastUpdated(arr: BudgetVersionLite[]): BudgetVersionLite | undefined {
  if (arr.length === 0) return undefined;
  return [...arr].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
}
function fmtDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}-${mm}-${yy}`;
}

export function computeCuadroResumen(input: CuadroResumenInput): CuadroResumenData {
  const { invoices, budgets } = input;
  // Selección de versión vigente — criterio único (selectVersion.ts): manda
  // una sola versión, la última enviada/aprobada. Antes acá se usaba solo
  // "aprobado" sin fallback, así que un presupuesto solo-enviado daba $0 en el
  // cuadro aunque el Resumen sí lo mostraba (se contradecían).
  const obrasVigentes = selectVigentes(budgets.filter((b) => b.type === "obra"));
  const mueblesVigentes = selectVigentes(budgets.filter((b) => b.type === "muebles"));
  const artefactosVigentes = selectVigentes(budgets.filter((b) => b.type === "artefactos"));
  const lastObra = lastUpdated(obrasVigentes);
  const lastMuebles = lastUpdated(mueblesVigentes);
  const lastArtefactos = lastUpdated(artefactosVigentes);

  // ── Acordado por concepto ───────────────────────────────────────────────
  //
  // Las partidas "NO COBRADO" (BLARQ las absorbe: se le pagan al maestro pero
  // no se le cobran al cliente) quedan FUERA del costo directo, igual que en
  // metrics.ts y en el PDF de la cotización. Hasta el 2026-07-30 este archivo
  // las sumaba: el Cuadro Resumen de Portofino mostraba $925.000 de más que la
  // tarjeta "Total Acordado" de la misma página, y el GG que se traspasa a
  // sueldos salía inflado en la parte proporcional. No se había visto antes
  // porque Portofino V7 es el primer presupuesto de la base con partidas
  // marcadas.
  const costoDirectoCobrable = (b: BudgetVersionLite) =>
    (b.obraItems ?? []).reduce((ss, it) => (it.noCobrado ? ss : ss + it.total), 0);

  const obraAcordado = obrasVigentes.reduce((s, b) => {
    const cd = costoDirectoCobrable(b);
    const gg = (b.ggPercentage ?? 0) / 100;
    const util = (b.utilityPercentage ?? 0) / 100;
    return s + cd * (1 + gg + util) * 1.19;
  }, 0);
  // Utilidad OBRA al 100% = GG total (lo que se traspasa a sueldos).
  const obraUtilidad100 = obrasVigentes.reduce(
    (s, b) => s + costoDirectoCobrable(b) * ((b.ggPercentage ?? 0) / 100),
    0
  );

  const mueblesItems = mueblesVigentes.flatMap((b) => (b.muebleChapters ?? []).flatMap((c) => c.items));
  const mueblesAcordado = mueblesItems.reduce((s, it) => s + it.clientPriceIva * it.quantity, 0);
  const mueblesUtilidad100 = mueblesItems.reduce(
    (s, it) => s + (it.clientPriceNet - it.costDistributor) * it.quantity,
    0
  );

  const sumaSub = (sub: string) =>
    artefactosVigentes.reduce(
      (s, b) =>
        s +
        (b.artefactoItems ?? [])
          .filter((it) => it.subcategory === sub)
          .reduce((ss, it) => ss + it.clientPrice * it.quantity, 0),
      0
    );
  const cocinaAcordado = sumaSub("cocina");
  const sanitariosAcordado = sumaSub("sanitario");
  const iluminacionAcordado = sumaSub("iluminacion");

  const totalAcordado =
    obraAcordado + cocinaAcordado + sanitariosAcordado + iluminacionAcordado + mueblesAcordado;

  // ── Pagos por concepto (artefactos: split proporcional al acordado) ──────
  const artefactosBase = cocinaAcordado + sanitariosAcordado + iluminacionAcordado;
  const ratioCocina = artefactosBase > 0 ? cocinaAcordado / artefactosBase : 0;
  const ratioSanitarios = artefactosBase > 0 ? sanitariosAcordado / artefactosBase : 0;
  const ratioIluminacion = artefactosBase > 0 ? iluminacionAcordado / artefactosBase : 0;

  // Construimos los pagos AGRUPADOS por fecha: todas las facturas cobradas el
  // mismo día (= un avance) van en una fila, con el monto y la factura por
  // concepto. Clave del grupo = la fecha (yyyy-mm-dd).
  const emptyConcepto = (): Record<ConceptoKey, { monto: number; folio: string | null }> => ({
    obra: { monto: 0, folio: null },
    cocina: { monto: 0, folio: null },
    sanitarios: { monto: 0, folio: null },
    iluminacion: { monto: 0, folio: null },
    muebles: { monto: 0, folio: null },
  });
  const grupos = new Map<string, PagoRow>();
  const addPago = (date: Date, key: ConceptoKey, monto: number, folio: string | null) => {
    if (!monto) return;
    const clave = date.toISOString().slice(0, 10);
    let row = grupos.get(clave);
    if (!row) {
      row = { date, porConcepto: emptyConcepto() };
      grupos.set(clave, row);
    }
    row.porConcepto[key].monto += monto;
    // Si ya había una factura para este concepto en la misma fecha, juntamos los folios.
    row.porConcepto[key].folio = row.porConcepto[key].folio
      ? `${row.porConcepto[key].folio}/${folio ?? ""}`
      : folio;
  };
  for (const inv of invoices.filter((i) => i.type === "emitida")) {
    // Desglose cargado a mano: la factura se reparte entre los 5 conceptos y
    // cada pago se prorratea por la fracción que representa del total. Cubre
    // tanto la factura COMBINADA (obra + muebles + artefactos, caso Portofino)
    // como el desglose de artefactos de siempre, que es el mismo mecanismo con
    // obra y muebles en cero.
    const desglose = desgloseDeCobro(inv);
    for (const p of inv.payments) {
      const date = new Date(p.bankMovement.date);
      if (desglose && inv.totalAmount > 0) {
        const frac = p.amountApplied / inv.totalAmount;
        addPago(date, "obra", desglose.obra * frac, inv.folioNumber);
        addPago(date, "muebles", desglose.muebles * frac, inv.folioNumber);
        addPago(date, "cocina", desglose.cocina * frac, inv.folioNumber);
        addPago(date, "sanitarios", desglose.sanitarios * frac, inv.folioNumber);
        addPago(date, "iluminacion", desglose.iluminacion * frac, inv.folioNumber);
        continue;
      }
      const concepto = conceptoDeFactura(inv);
      if (concepto === "obra") addPago(date, "obra", p.amountApplied, inv.folioNumber);
      else if (concepto === "muebles") addPago(date, "muebles", p.amountApplied, inv.folioNumber);
      else if (concepto === "artefactos") {
        // Sin desglose cargado: se reparte proporcional al presupuesto de
        // artefactos.
        addPago(date, "cocina", p.amountApplied * ratioCocina, inv.folioNumber);
        addPago(date, "sanitarios", p.amountApplied * ratioSanitarios, inv.folioNumber);
        addPago(date, "iluminacion", p.amountApplied * ratioIluminacion, inv.folioNumber);
      }
    }
  }
  const pagos: PagoRow[] = [...grupos.values()].sort((a, b) => a.date.getTime() - b.date.getTime());

  const obraDate = lastObra ? fmtDate(new Date(lastObra.updatedAt)) : "";
  const artefactosDate = lastArtefactos ? fmtDate(new Date(lastArtefactos.updatedAt)) : "";
  const mueblesDate = lastMuebles ? fmtDate(new Date(lastMuebles.updatedAt)) : "";

  const conceptosAll: ConceptoCuadro[] = [
    { key: "obra", label: "Obra", acordado: obraAcordado, fecha: obraDate, generaSueldo: true, utilidad100: obraUtilidad100, pagado: 0, avancePct: 0, saldo: 0 },
    { key: "cocina", label: "Art. Cocina", acordado: cocinaAcordado, fecha: artefactosDate, generaSueldo: false, utilidad100: 0, pagado: 0, avancePct: 0, saldo: 0 },
    { key: "sanitarios", label: "Art. Sanitarios", acordado: sanitariosAcordado, fecha: artefactosDate, generaSueldo: false, utilidad100: 0, pagado: 0, avancePct: 0, saldo: 0 },
    { key: "iluminacion", label: "Art. Iluminación", acordado: iluminacionAcordado, fecha: artefactosDate, generaSueldo: false, utilidad100: 0, pagado: 0, avancePct: 0, saldo: 0 },
    { key: "muebles", label: "Muebles", acordado: mueblesAcordado, fecha: mueblesDate, generaSueldo: true, utilidad100: mueblesUtilidad100, pagado: 0, avancePct: 0, saldo: 0 },
  ];
  const conceptos = conceptosAll.filter((c) => c.acordado > 0);
  for (const c of conceptos) {
    c.pagado = pagos.reduce((s, r) => s + r.porConcepto[c.key].monto, 0);
    c.avancePct = c.acordado > 0 ? c.pagado / c.acordado : 0;
    c.saldo = c.acordado - c.pagado;
  }

  const totalPagado = conceptos.reduce((s, c) => s + c.pagado, 0);
  const saldoTotal = totalAcordado - totalPagado;
  const avanceTotal = totalAcordado > 0 ? totalPagado / totalAcordado : 0;

  const maxPerType = Math.max(
    obrasVigentes.length,
    mueblesVigentes.length,
    artefactosVigentes.length
  );
  const versionLabel =
    maxPerType <= 1
      ? lastObra?.version ?? lastMuebles?.version ?? lastArtefactos?.version ?? "—"
      : "Acordado";

  return { conceptos, pagos, totalAcordado, totalPagado, saldoTotal, avanceTotal, versionLabel };
}
