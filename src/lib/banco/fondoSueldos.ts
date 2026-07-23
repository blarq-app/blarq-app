// Cálculo del "Fondo Sueldos" — la plata que MJ se traspasa a cuenta
// sueldos según la utilidad de cada proyecto.
//
// Reglas (las dictó MJ):
//   - Obra: lo que se traspasa son los GG (20-25% del costo directo).
//     Proporcional al cobro real: si cobró 30% del proyecto-obra, traspasa
//     30% del GG total.
//   - Muebles: utilidad neta por item (clientPriceNet − costDistributor),
//     proporcional al cobrado de muebles.
//   - Artefactos: NADA. Su margen queda en empresa.
//
// Para que esto funcione, las facturas EMITIDAS necesitan tener
// `conceptoCobro` (obra | muebles | artefactos) que indica qué tipo de
// pago es. Si está vacío, default = obra (lo más común).

import type { Prisma } from "@prisma/client";
import { conceptoDeFactura } from "@/lib/invoices/conceptoCobro";
import { selectVigente, selectVigentes } from "@/lib/projects/selectVersion";

const projectFondoInclude = {
  invoices: {
    where: { type: "emitida" },
    select: {
      id: true,
      type: true,
      tipoDoc: true,
      totalAmount: true,
      conceptoCobro: true,
      // Categoría asignada por MJ (Obra/Muebles/Artefactos) — fuente de verdad
      // del concepto del cobro. Ver conceptoDeFactura.
      category: { select: { name: true } },
      status: true,
      payments: { select: { amountApplied: true } },
    },
  },
  budgetVersions: {
    include: {
      obraItems: { select: { total: true, costMaterial: true, costLabor: true, costTools: true, costSubcontract: true, costLoss: true, quantity: true } },
      muebleChapters: { include: { items: { select: { quantity: true, costDistributor: true, clientPriceNet: true, clientPriceIva: true } } } },
      artefactoItems: { select: { clientPrice: true } },
    },
  },
} satisfies Prisma.ProjectInclude;

export type ProjectWithFondo = Prisma.ProjectGetPayload<{ include: typeof projectFondoInclude }>;

export const PROJECT_FONDO_INCLUDE = projectFondoInclude;

export type FondoSueldosCalculo = {
  // Total del fondo a generar si el proyecto se cobra al 100%.
  totalFondoMaximo: number;
  // Detalle por tipo
  obraGGTotal: number;       // GG total presupuestado (CD × ggPercentage)
  obraGGPercentage: number;  // GG% real del presupuesto de obra (ej. 20 = 20%)
  obraCobrado: number;       // suma de facturas emitidas cobradas con concepto "obra"
  obraTotalAcordado: number; // CD × (1+gg) × (1+util) × IVA = lo que se cobra al cliente
  pctCobradoObra: number;    // 0..1
  fondoObraGenerado: number; // pctCobradoObra × obraGGTotal

  utilMueblesTotal: number;
  mueblesCobrado: number;
  mueblesTotalAcordado: number;
  pctCobradoMuebles: number;
  fondoMueblesGenerado: number;

  artefactosTotalAcordado: number; // solo informativo, no aporta al fondo

  // Suma de los 2 fondos generados
  fondoGenerado: number;
};

export function computeFondoSueldos(p: ProjectWithFondo): FondoSueldosCalculo {
  // Criterio único de selección (selectVersion.ts): manda una sola versión, la
  // última enviada/aprobada (igual que metrics.ts). selectVigentes devuelve un
  // arreglo de 0 ó 1; el loop de abajo lo recorre igual (ya no hay anexos).
  const obras = selectVigentes(p.budgetVersions.filter((b) => b.type === "obra"));
  const obra = selectVigente(p.budgetVersions.filter((b) => b.type === "obra"));
  const muebles = selectVigente(p.budgetVersions.filter((b) => b.type === "muebles"));
  const artefactos = selectVigente(p.budgetVersions.filter((b) => b.type === "artefactos"));

  // ── Obra ────────────────────────────────────────────────────────────
  // La obra vigente con sus % de GG/utilidad (el loop soporta más de una por
  // compatibilidad, pero hoy selectVigentes devuelve una sola).
  let obraGGTotal = 0;
  let obraTotalAcordado = 0;
  for (const o of obras) {
    const cd = o.obraItems.reduce((s, i) => s + i.total, 0);
    const ggPct = (o.ggPercentage ?? 0) / 100;
    const utilPct = (o.utilityPercentage ?? 0) / 100;
    obraGGTotal += cd * ggPct;
    obraTotalAcordado += cd * (1 + ggPct) * (1 + utilPct) * 1.19;
  }

  // ── Muebles ─────────────────────────────────────────────────────────
  const muebleItems = muebles ? muebles.muebleChapters.flatMap((c) => c.items) : [];
  const utilMueblesTotal = muebleItems.reduce(
    (s, i) => s + (i.clientPriceNet - i.costDistributor) * i.quantity,
    0
  );
  const mueblesTotalAcordado = muebleItems.reduce(
    (s, i) => s + i.clientPriceIva * i.quantity,
    0
  );

  // ── Artefactos ──────────────────────────────────────────────────────
  const artefactosTotalAcordado = artefactos
    ? artefactos.artefactoItems.reduce((s, i) => s + i.clientPrice, 0)
    : 0;

  // ── Cobrado por concepto ────────────────────────────────────────────
  // Sumamos lo efectivamente cobrado (suma de InvoicePayment) agrupado por
  // conceptoCobro. Esto incluye facturas en estado "parcial" (cobradas por
  // partes) — el fondo crece proporcional a lo recibido, no espera a que
  // la factura esté 100% pagada.
  // Las NCs emitidas (tipoDoc=61) restan, porque revierten el cobro.
  // Si conceptoCobro es null/undefined, default = "obra" (lo más frecuente).
  let obraCobrado = 0;
  let mueblesCobrado = 0;
  for (const inv of p.invoices) {
    const sign = inv.tipoDoc === 61 ? -1 : 1;
    // Si tiene payments, sumarlos. Sino, fallback a totalAmount cuando
    // status="pagada" (cobros marcados a mano sin movimiento bancario).
    const payments = inv.payments ?? [];
    const cobradoDeFactura =
      payments.length > 0
        ? payments.reduce((s, p) => s + p.amountApplied, 0)
        : inv.status === "pagada"
          ? inv.totalAmount
          : 0;
    const signed = sign * cobradoDeFactura;
    // Concepto del cobro = categoría que asigna MJ (Obra/Muebles/Artefactos),
    // con respaldo al campo legacy conceptoCobro. Antes era `conceptoCobro ??
    // "obra"` → contaba TODO cobro sin concepto como obra (inflaba obra, dejaba
    // muebles en cero). Ver conceptoDeFactura.
    const concepto = conceptoDeFactura(inv);
    if (concepto === "muebles") mueblesCobrado += signed;
    else if (concepto === "obra") obraCobrado += signed;
    // artefactos / sin concepto no aportan al fondo
  }

  const pctCobradoObra = obraTotalAcordado > 0 ? Math.min(1, obraCobrado / obraTotalAcordado) : 0;
  const pctCobradoMuebles = mueblesTotalAcordado > 0 ? Math.min(1, mueblesCobrado / mueblesTotalAcordado) : 0;
  const fondoObraGenerado = obraGGTotal * pctCobradoObra;
  const fondoMueblesGenerado = utilMueblesTotal * pctCobradoMuebles;
  const totalFondoMaximo = obraGGTotal + utilMueblesTotal;
  const fondoGenerado = fondoObraGenerado + fondoMueblesGenerado;

  return {
    totalFondoMaximo,
    obraGGTotal,
    obraGGPercentage: obra?.ggPercentage ?? 0,
    obraCobrado,
    obraTotalAcordado,
    pctCobradoObra,
    fondoObraGenerado,
    utilMueblesTotal,
    mueblesCobrado,
    mueblesTotalAcordado,
    pctCobradoMuebles,
    fondoMueblesGenerado,
    artefactosTotalAcordado,
    fondoGenerado,
  };
}

// Planilla mensual aproximada (entre los socios). Se usa para calcular
// "alcance estimado en meses" del fondo sueldos. Cuando esto crezca conviene
// moverlo a una tabla de configuración editable desde la app.
export const PLANILLA_MENSUAL_CLP = 11_000_000;
