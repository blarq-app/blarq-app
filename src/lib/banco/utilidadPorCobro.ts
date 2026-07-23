// Utilidad por cobro — cuánto de CADA cobro al cliente es utilidad que MJ se
// traspasa a la cuenta Sueldos. Es el desglose "por estado de pago" de lo que
// hoy `fondoSueldos.ts` da acumulado.
//
// Reglas (las dictó MJ, 2026-06-16):
//
//   OBRA — la utilidad que se sacan es el GG declarado al cliente (20-25% del
//   costo directo), sumando TODAS las versiones aprobadas (anexos/adicionales
//   incluidos, igual que metrics.ts). De cada peso cobrado de obra, la
//   fracción de utilidad = GG_neto / total_acordado_obra (c/IVA). El 5% de
//   "utilidad" declarada y lo que sobre de los márgenes se queda en Operativa.
//
//   MUEBLES, en ejecución — utilidad ESTIMADA del presupuesto
//   (clientPriceNet − costDistributor), proporcional al cobro.
//
//   MUEBLES, al marcar el proyecto TERMINADO — la utilidad total pasa a ser la
//   REAL (cobrado neto − gastado neto de muebles). Se agrega una línea de
//   "ajuste final" = real − lo ya reconocido por las estimadas. Es el "lo que
//   falte para llegar al total" del cierre.
//
//   ARTEFACTOS — NO generan utilidad para sueldos (su margen queda en empresa).
//
// La "sugerencia de traspaso" de un cobro = su utilidad. La app NO mueve plata;
// solo saca la cuenta.
//
// Este módulo es de SOLO LECTURA y ADITIVO: no reemplaza fondoSueldos.ts ni
// toca metrics.ts. Reutiliza la misma definición de "cobrado" (suma de
// InvoicePayment, fallback a totalAmount si status="pagada", NC restan), así
// que el total reconocido de obra coincide con `fondoObraGenerado`. Cuando esto
// se cablee a la UI se unificará para no duplicar la fuente de verdad.

import type { Prisma } from "@prisma/client";
import { selectVigente } from "@/lib/projects/selectVersion";

// Categorías de costo que cuentan como "muebles" para la utilidad REAL de
// muebles al cierre. Derivado de cómo /resumen separa el gasto por concepto.
// OJO: confirmar con MJ que estas son TODAS las categorías de gasto de muebles
// (y que ninguna se solapa con obra) antes de confiar en el ajuste final.
const MUEBLES_COST_CATEGORIES = new Set([
  "Mueble",
  "Muebles",
  "Herrajes",
  "Cubiertas",
]);

const include = {
  invoices: {
    select: {
      id: true,
      type: true,
      tipoDoc: true,
      issueDate: true,
      folioNumber: true,
      netAmount: true,
      totalAmount: true,
      conceptoCobro: true,
      status: true,
      payments: { select: { amountApplied: true } },
      category: { select: { name: true, parent: { select: { name: true } } } },
    },
  },
  budgetVersions: {
    include: {
      obraItems: { select: { total: true } },
      muebleChapters: {
        include: {
          items: {
            select: { quantity: true, costDistributor: true, clientPriceNet: true, clientPriceIva: true },
          },
        },
      },
    },
  },
} satisfies Prisma.ProjectInclude;

export type ProjectWithUtilidad = Prisma.ProjectGetPayload<{ include: typeof include }> & {
  status: string;
};

export const PROJECT_UTILIDAD_INCLUDE = include;

export type CobroUtilidad = {
  invoiceId: string;
  folio: string | null;
  fecha: Date;
  concepto: string; // obra | muebles | artefactos | mixto (null → obra)
  esNotaCredito: boolean;
  cobradoCIVA: number; // lo cobrado de esta factura (con signo: NC negativo)
  utilidad: number; // cuánto de ese cobro es utilidad para sueldos
  sugerenciaTraspaso: number; // = utilidad
};

export type UtilidadPorCobro = {
  cobros: CobroUtilidad[];

  // Tasas usadas (transparencia)
  tasaUtilidadObra: number; // GG_neto / totalAcordadoObra (c/IVA)
  tasaUtilidadMuebles: number; // utilEstimada / totalAcordadoMuebles (c/IVA)

  // Totales presupuestados
  obraGGTotal: number;
  obraTotalAcordado: number;
  utilMueblesEstimadaTotal: number;
  mueblesTotalAcordado: number;

  // Reconocido por las estimadas (proporcional al cobro), YA TOPADO al máximo
  // (no se reconoce más utilidad que el GG/util total que el presupuesto
  // respalda — criterio conservador, igual que el Fondo Sueldos).
  utilidadObraReconocida: number;
  utilidadMueblesReconocida: number;

  // Alertas: el cobro de ese concepto superó el total acordado del presupuesto
  // → o hay adicionales sin cargar, o cobros mal etiquetados. La utilidad
  // quedó topada; conviene revisar el presupuesto / el conceptoCobro.
  sobreCobroObra: boolean;
  sobreCobroMuebles: boolean;

  // Cierre de muebles (solo si el proyecto está terminado/cerrado)
  proyectoTerminado: boolean;
  mueblesCobradoNeto: number | null;
  mueblesGastadoNeto: number | null;
  utilidadMueblesReal: number | null; // cobradoNeto − gastadoNeto
  ajusteFinalMuebles: number | null; // real − reconocida estimada

  // Totales finales
  utilidadTotalReconocida: number; // obra + muebles (+ ajuste si terminado)
  sugerenciaTraspasoTotal: number;
};

// Mismo criterio de "cobrado" que fondoSueldos.ts: suma de InvoicePayment;
// si no hay pagos pero la factura está "pagada", fallback a totalAmount.
function cobradoDe(inv: {
  payments: { amountApplied: number }[];
  status: string;
  totalAmount: number;
}): number {
  if (inv.payments.length > 0) {
    return inv.payments.reduce((s, p) => s + p.amountApplied, 0);
  }
  return inv.status === "pagada" ? inv.totalAmount : 0;
}

export function computeUtilidadPorCobro(p: ProjectWithUtilidad): UtilidadPorCobro {
  const terminado = p.status === "terminado" || p.status === "cerrado";

  // ── OBRA: GG y total acordado sobre las versiones APROBADAS ──────
  // OJO (2026-07-22): este módulo NO usa el criterio único de selectVersion.ts.
  // Filtra solo status "aprobado" (sin el fallback a "enviado" ni el "una sola
  // versión"). Para proyectos con la obra solo ENVIADA (no aprobada aún) esto
  // da tasa de utilidad 0 — diferencia PREEXISTENTE, no la introdujo el cambio
  // de "una sola versión". Alinearlo con selectVigentes movería la utilidad
  // traspasada en ~6 proyectos, así que se dejó como estaba; pendiente decidir
  // con MJ. Cada versión aporta con su propio ggPercentage/utilityPercentage.
  const obrasAprobadas = p.budgetVersions.filter(
    (b) => b.type === "obra" && b.status === "aprobado"
  );
  let obraGGTotal = 0;
  let obraTotalAcordado = 0;
  for (const o of obrasAprobadas) {
    const cd = o.obraItems.reduce((s, i) => s + i.total, 0);
    const ggPct = (o.ggPercentage ?? 0) / 100;
    const utilPct = (o.utilityPercentage ?? 0) / 100;
    obraGGTotal += cd * ggPct;
    obraTotalAcordado += cd * (1 + ggPct) * (1 + utilPct) * 1.19;
  }
  const tasaUtilidadObra = obraTotalAcordado > 0 ? obraGGTotal / obraTotalAcordado : 0;

  // ── MUEBLES: utilidad estimada y total acordado (versión vigente) ──────
  // Criterio único de "versión vigente" (selectVersion.ts), el mismo que usan
  // metrics/resumen/fondo. Antes había una copia local (`bestVersion`) que
  // podía divergir.
  const muebles = selectVigente(p.budgetVersions.filter((b) => b.type === "muebles"));
  const muebleItems = muebles ? muebles.muebleChapters.flatMap((c) => c.items) : [];
  const utilMueblesEstimadaTotal = muebleItems.reduce(
    (s, i) => s + (i.clientPriceNet - i.costDistributor) * i.quantity,
    0
  );
  const mueblesTotalAcordado = muebleItems.reduce(
    (s, i) => s + i.clientPriceIva * i.quantity,
    0
  );
  const tasaUtilidadMuebles =
    mueblesTotalAcordado > 0 ? utilMueblesEstimadaTotal / mueblesTotalAcordado : 0;

  // ── Cobros (facturas emitidas) → utilidad por cobro ────────────────────
  const emitidas = p.invoices.filter((i) => i.type === "emitida");
  const cobros: CobroUtilidad[] = [];
  let obraCobradoCIVA = 0;
  let mueblesCobradoCIVA = 0;

  for (const inv of emitidas) {
    const esNC = inv.tipoDoc === 61;
    const sign = esNC ? -1 : 1;
    const cobradoCIVA = sign * cobradoDe(inv);
    if (cobradoCIVA === 0) continue; // factura aún sin cobrar → no genera utilidad

    const concepto = inv.conceptoCobro ?? "obra";
    let utilidad = 0;
    if (concepto === "obra") {
      utilidad = cobradoCIVA * tasaUtilidadObra;
      obraCobradoCIVA += cobradoCIVA;
    } else if (concepto === "muebles") {
      utilidad = cobradoCIVA * tasaUtilidadMuebles;
      mueblesCobradoCIVA += cobradoCIVA;
    }
    // artefactos / mixto → utilidad 0 (queda en empresa)

    cobros.push({
      invoiceId: inv.id,
      folio: inv.folioNumber,
      fecha: inv.issueDate,
      concepto,
      esNotaCredito: esNC,
      cobradoCIVA,
      utilidad,
      sugerenciaTraspaso: utilidad,
    });
  }
  cobros.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

  // Reconocido = utilidad acumulada, TOPADA al máximo del presupuesto. No se
  // sugiere sacar más GG (o más utilidad de muebles) del que el presupuesto
  // respalda — conservador, igual que el Fondo Sueldos. Si el cobro superó el
  // acordado (adicionales sin cargar o cobros mal etiquetados), se topa y se
  // levanta una alerta.
  const utilidadObraReconocida = Math.min(obraGGTotal, obraCobradoCIVA * tasaUtilidadObra);
  const utilidadMueblesReconocida = Math.min(
    utilMueblesEstimadaTotal,
    mueblesCobradoCIVA * tasaUtilidadMuebles
  );
  // Tolerancia del 0,1%: ignora el redondeo entre la suma de pagos y el
  // acordado (un cobro 100% pagado puede dar unos pesos de más). Un sobre-cobro
  // real (adicionales sin cargar / cobro mal etiquetado) es mucho mayor.
  const sobreCobroObra = obraTotalAcordado > 0 && obraCobradoCIVA > obraTotalAcordado * 1.001;
  const sobreCobroMuebles = mueblesTotalAcordado > 0 && mueblesCobradoCIVA > mueblesTotalAcordado * 1.001;

  // ── Cierre de muebles: utilidad REAL (cobrado neto − gastado neto) ─────
  // Solo cuando el proyecto está terminado. El gastado de muebles sale de las
  // facturas recibidas cuya categoría cae en MUEBLES_COST_CATEGORIES.
  let mueblesCobradoNeto: number | null = null;
  let mueblesGastadoNeto: number | null = null;
  let utilidadMueblesReal: number | null = null;
  let ajusteFinalMuebles: number | null = null;

  if (terminado && muebles) {
    // Cobrado neto de muebles: el cobrado c/IVA de muebles sin IVA. Muebles
    // siempre lleva 19%, así que dividir por 1.19 es exacto.
    mueblesCobradoNeto = mueblesCobradoCIVA / 1.19;

    // Gastado neto de muebles: facturas recibidas de categorías de muebles.
    mueblesGastadoNeto = 0;
    for (const inv of p.invoices) {
      if (inv.type !== "recibida") continue;
      const catName = inv.category?.name ?? "";
      const topName = inv.category?.parent?.name ?? catName;
      if (!MUEBLES_COST_CATEGORIES.has(catName) && !MUEBLES_COST_CATEGORIES.has(topName)) {
        continue;
      }
      const sign = inv.tipoDoc === 61 ? -1 : 1;
      mueblesGastadoNeto += sign * inv.netAmount;
    }

    utilidadMueblesReal = mueblesCobradoNeto - mueblesGastadoNeto;
    ajusteFinalMuebles = utilidadMueblesReal - utilidadMueblesReconocida;
  }

  const utilidadTotalReconocida =
    utilidadObraReconocida +
    utilidadMueblesReconocida +
    (ajusteFinalMuebles ?? 0);

  return {
    cobros,
    tasaUtilidadObra,
    tasaUtilidadMuebles,
    obraGGTotal,
    obraTotalAcordado,
    utilMueblesEstimadaTotal,
    mueblesTotalAcordado,
    utilidadObraReconocida,
    utilidadMueblesReconocida,
    sobreCobroObra,
    sobreCobroMuebles,
    proyectoTerminado: terminado,
    mueblesCobradoNeto,
    mueblesGastadoNeto,
    utilidadMueblesReal,
    ajusteFinalMuebles,
    utilidadTotalReconocida,
    sugerenciaTraspasoTotal: utilidadTotalReconocida,
  };
}

