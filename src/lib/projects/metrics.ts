// Métricas resumen por proyecto. Usado por el top-level dashboard (cards
// rápidas) y la página de Estado de Resultados (banners de alerta).
//
// Toda la lógica vive acá — los consumidores solo eligen qué mostrar.

import type { Prisma } from "@prisma/client";

// Forma del proyecto que necesitamos: con sus relaciones financieras.
// Definida como tipo Prisma para que cualquier llamador haga el include
// correcto.
const projectMetricsInclude = {
  invoices: {
    include: {
      category: { include: { parent: true } },
    },
  },
  budgetVersions: {
    include: {
      obraItems: true,
      muebleChapters: { include: { items: true } },
      artefactoItems: true,
    },
  },
  estadosPago: {
    include: { items: true },
  },
  maestro: true,
} satisfies Prisma.ProjectInclude;

export type ProjectWithMetrics = Prisma.ProjectGetPayload<{
  include: typeof projectMetricsInclude;
}>;

export const PROJECT_METRICS_INCLUDE = projectMetricsInclude;

export type AlertSeverity = "info" | "warning" | "danger";

export type ProjectAlert = {
  severity: AlertSeverity;
  message: string;
};

export type CategoryDeviation = {
  name: string;
  presupuestado: number;
  real: number;
  pct: number; // real / presupuestado * 100
};

export type ProjectMetrics = {
  // Versiones base (preferentemente aprobadas, fallback a más reciente)
  versionLabels: { obra?: string; muebles?: string; artefactos?: string };

  // Resumen financiero (todos los montos en CLP).
  //
  // C/IVA vs NETO — convención del módulo:
  //   - totalAcordado / totalCobrado: c/IVA (lo que el cliente paga / firma).
  //     Se usan en cards "Total acordado", "Cobrado", barra de progreso de
  //     cobros y forma de pago — porque las cuotas % se calculan sobre lo
  //     que el cliente firma, que es c/IVA.
  //   - totalAcordadoNeto / totalCobradoNeto: sin IVA (ingreso real para
  //     BLARQ — el IVA se devuelve al SII). Usado SOLO para utilidadReal,
  //     que mide cuánta plata efectivamente queda para BLARQ.
  //   - totalGastado: ya es neto (el IVA pagado se recupera como crédito).
  //
  // Antes utilidadReal mezclaba criterios (cobrado c/IVA - gastado neto) y
  // salía inflada ~19%. Bug arreglado en Plan B 2026-05-05.
  totalAcordado: number; // c/IVA — obra + muebles + artefactos al cliente
  totalAcordadoNeto: number; // sin IVA — para utilidad
  totalCobrado: number; // c/IVA — entra a caja
  totalCobradoNeto: number; // sin IVA — para utilidad
  totalGastado: number; // neto — facturas recibidas (incluye pagos sin respaldo)
  totalGastadoConIva: number; // c/IVA — facturas recibidas (totalAmount)
  utilidadReal: number; // = totalCobradoNeto − totalGastado
  // Utilidad PROYECTADA: lo que MJ se queda cuando termine de cobrar el
  // total acordado. Útil para proyectos terminados con saldo pendiente,
  // o como vista de "rentabilidad esperada" en cualquier momento.
  // = totalAcordadoNeto − totalGastado.
  utilidadProyectada: number;
  pctCobrado: number; // 0..100+ (sobre c/IVA, para coherencia con la barra)

  // Avance obra (% ponderado por MO presupuestada según EPs)
  avanceObraPct: number;

  // Desviaciones por concepto interno (Materiales, MO, Herramientas, etc.)
  conceptDeviations: CategoryDeviation[];
  worstDeviation: CategoryDeviation | null;

  // Agregaciones brutas — útiles para construir vistas customizadas
  // (EERR jerárquico, tablas con drill-down, etc) sin re-recorrer facturas.
  budgetByType: Record<string, number>; // por costMaterial/costLabor/...
  realByCategory: Record<string, number>; // por nombre de top category
  realBySpecific: Record<string, number>; // por nombre exacto de category

  // Compromisos / cosas que requieren atención
  invoicesOverdueCount: number;
  invoicesOverdueAmount: number;
  invoicesPendingCount: number;
  draftEPsCount: number;

  // Alertas consolidadas listas para mostrar
  alerts: ProjectAlert[];
};

const CATEGORY_TO_BREAKDOWN: Record<
  string,
  "costMaterial" | "costLabor" | "costTools" | "costSubcontract" | "costLoss"
> = {
  Materiales: "costMaterial",
  "Mano de obra": "costLabor",
  Herramientas: "costTools",
  Subcontrato: "costSubcontract",
  Pérdidas: "costLoss",
};

// Selecciona la mejor versión para cada tipo: aprobada más reciente, o la
// última creada si no hay aprobada. Usado para muebles y artefactos donde
// se espera UNA versión vigente. Para obra usamos `allApproved` que suma
// múltiples obras (caso anexos como BAÑO VISITAS — ver business-model.md).
function bestVersion<T extends { status: string; createdAt: Date }>(arr: T[]) {
  const aprobado = arr
    .filter((b) => b.status === "aprobado")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return (
    aprobado ??
    arr.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
  );
}

// Para obra: TODAS las versiones aprobadas (un proyecto puede tener una
// obra principal V7 + un anexo V4-BANO-VISITAS, ambos aprobados, que suman
// al Total Acordado). Si no hay aprobadas, fallback a la más reciente.
function allApproved<T extends { status: string; createdAt: Date }>(arr: T[]): T[] {
  const aprobadas = arr.filter((b) => b.status === "aprobado");
  if (aprobadas.length > 0) return aprobadas;
  const fallback = arr.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return fallback ? [fallback] : [];
}

export function computeProjectMetrics(project: ProjectWithMetrics): ProjectMetrics {
  const obras = allApproved(
    project.budgetVersions.filter((b) => b.type === "obra")
  );
  // Mantener `obra` como referencia primaria (la primera de las aprobadas)
  // para campos que esperan una sola versión, ej: versionLabels en UI.
  const obra = obras[0];
  const muebles = bestVersion(
    project.budgetVersions.filter((b) => b.type === "muebles")
  );
  const artefactos = bestVersion(
    project.budgetVersions.filter((b) => b.type === "artefactos")
  );

  // ── Total acordado ────────────────────────────────────────────────────
  // Fórmula BLARQ confirmada con MJ 2026-05-05 contra Excel V4 Pauline
  // Dumay: GG y Utilidad se aplican ADITIVOS sobre el costo directo (no
  // encadenados). Verificado: costo directo $26.948.285 → costo total
  // c/IVA $41.047.628 (GG 23% + Util 5% + IVA 19%, todos sobre
  // costoDirecto excepto IVA que es sobre el neto).
  //
  // Cuando hay múltiples obras aprobadas (caso anexos como BAÑO VISITAS),
  // se calcula el costo total de cada una con sus propios % y se suman.
  let obraCostoDirecto = 0;
  let obraGG = 0;
  let obraUtilidad = 0;
  let obraNeto = 0;
  let obraTotal = 0;
  for (const o of obras) {
    const cd = o.obraItems.reduce((s, i) => s + i.total, 0);
    const gg = cd * ((o.ggPercentage ?? 0) / 100);
    const util = cd * ((o.utilityPercentage ?? 0) / 100);
    const neto = cd + gg + util;
    obraCostoDirecto += cd;
    obraGG += gg;
    obraUtilidad += util;
    obraNeto += neto;
    obraTotal += neto * 1.19;
  }

  // Muebles: subtotal (suma items) − descuento global del BudgetVersion.
  // El descuento se guarda como decimal (0.02 = 2%) en BudgetVersion y
  // aplica sobre subtotal c/IVA y subtotal neto por igual.
  const mueblesItems = muebles
    ? muebles.muebleChapters.flatMap((c) => c.items)
    : [];
  const mueblesDiscount = (muebles?.discountPercentage ?? 0);
  const mueblesSubtotalIva = mueblesItems.reduce(
    (s, i) => s + i.clientPriceIva * i.quantity,
    0
  );
  const mueblesSubtotalNeto = mueblesItems.reduce(
    (s, i) => s + i.clientPriceNet * i.quantity,
    0
  );
  const mueblesTotal = mueblesSubtotalIva * (1 - mueblesDiscount);
  const mueblesTotalNeto = mueblesSubtotalNeto * (1 - mueblesDiscount);

  const artefactosTotal = artefactos
    ? artefactos.artefactoItems.reduce(
        (s, i) => s + i.clientPrice * i.quantity,
        0
      )
    : 0;
  // Artefactos: clientPrice es el precio UNITARIO final al cliente (c/IVA);
  // se multiplica por quantity. El neto es / 1.19. Si en el futuro se
  // decide cargar neto, ajustar acá y en mueblesTotalNeto.
  const artefactosTotalNeto = artefactosTotal / 1.19;

  const totalAcordado = obraTotal + mueblesTotal + artefactosTotal;
  const totalAcordadoNeto = obraNeto + mueblesTotalNeto + artefactosTotalNeto;

  // ── Cobrado / Gastado ─────────────────────────────────────────────────
  const facturasEmitidas = project.invoices.filter((i) => i.type === "emitida");
  const facturasRecibidas = project.invoices.filter(
    (i) => i.type === "recibida"
  );
  // Una nota de crédito (DTE 61) revierte una factura — debe restar, no sumar.
  // Aplica para ambos lados: NC recibida = proveedor te devolvió plata; NC
  // emitida = devolviste plata al cliente.
  const sign = (i: { tipoDoc: number | null }) => (i.tipoDoc === 61 ? -1 : 1);
  // Cobrado al cliente: c/IVA (es lo que efectivamente entra a caja).
  const totalCobrado = facturasEmitidas.reduce(
    (s, i) => s + sign(i) * i.totalAmount,
    0
  );
  // Cobrado NETO: lo mismo pero sin IVA. El IVA cobrado al cliente se le
  // devuelve al SII, así que el ingreso real para BLARQ es el neto. Se
  // usa solo para calcular la utilidad real.
  const totalCobradoNeto = facturasEmitidas.reduce(
    (s, i) => s + sign(i) * i.netAmount,
    0
  );
  // Gastado: NETO. El IVA pagado a proveedores se recupera como crédito
  // fiscal, así que el costo real de un insumo para BLARQ es el neto.
  // Comparar contra el presupuesto (que está en neto) requiere usar neto
  // también — sino el "real" sale inflado ~19% artificialmente.
  const totalRecibidoFacturas = facturasRecibidas.reduce(
    (s, i) => s + sign(i) * i.netAmount,
    0
  );

  // El gasto contable del proyecto sale SOLO de facturas recibidas — y
  // eso incluye los "pagos sin respaldo" (Invoice type=recibida,
  // tipoDoc=1043), que es como se registran las transferencias a
  // maestros que no emiten documento.
  //
  // Los Estados de Pago NO se cuentan como costo. Un EP es una
  // herramienta de cálculo: dice cuánto pagarle al maestro según el
  // avance de obra. La huella contable del gasto es la transferencia
  // registrada como factura o como pago sin respaldo, no el EP.
  // Si se sumara el EP además del pago, el costo se contaría dos veces.
  // Decisión de MJ 2026-05-16 (ver WIP.md / CHANGELOG).
  const totalGastado = totalRecibidoFacturas;
  // Versión c/IVA del gastado: para mostrar al lado del neto en la card.
  const totalRecibidoFacturasConIva = project.invoices
    .filter((i) => i.type === "recibida")
    .reduce((s, i) => s + sign(i) * i.totalAmount, 0);
  const totalGastadoConIva = totalRecibidoFacturasConIva;
  // Utilidad real: NETO contra NETO (antes mezclaba c/IVA y salía inflada
  // ~19%). totalCobradoNeto = ingreso real, totalGastado ya es neto.
  const utilidadReal = totalCobradoNeto - totalGastado;
  // Utilidad proyectada: lo que MJ se queda cuando termine de cobrar el
  // total acordado, restando los gastos.
  const utilidadProyectada = totalAcordadoNeto - totalGastado;
  const pctCobrado = totalAcordado > 0 ? (totalCobrado / totalAcordado) * 100 : 0;

  // ── Desviaciones por concepto interno ─────────────────────────────────
  // Suma componentes de TODAS las obras aprobadas (incluye anexos como
  // BAÑO VISITAS). costMargin se incluye explícitamente: el margen por
  // partida es parte del costo directo y MJ quiere verlo en el resumen.
  const obraItems = obras.flatMap((o) => o.obraItems);
  const budgetByType: Record<string, number> = {
    costMaterial: 0,
    costLabor: 0,
    costTools: 0,
    costSubcontract: 0,
    costLoss: 0,
    costMargin: 0,
  };
  for (const it of obraItems) {
    budgetByType.costMaterial += (it.costMaterial ?? 0) * it.quantity;
    budgetByType.costLabor += (it.costLabor ?? 0) * it.quantity;
    budgetByType.costTools += (it.costTools ?? 0) * it.quantity;
    budgetByType.costSubcontract += (it.costSubcontract ?? 0) * it.quantity;
    budgetByType.costLoss += (it.costLoss ?? 0) * it.quantity;
    budgetByType.costMargin += (it.costMargin ?? 0) * it.quantity;
  }

  // Agrupamos en dos formas:
  //   - byTop: categoría top (Materiales, Muebles, etc) — para conceptos de obra
  //   - bySpecific: categoría exacta asignada — para sub-categorías
  //     (Cubiertas, Herrajes; Cocina, Baño, Iluminación)
  // Neto, no totalAmount — el presupuesto está en neto, el IVA se recupera
  // como crédito fiscal. Comparar c/IVA vs neto inflaba el "real" ~19%.
  const realByCategory: Record<string, number> = {};
  const realBySpecific: Record<string, number> = {};
  for (const inv of facturasRecibidas) {
    const cat = inv.category;
    if (!cat) continue;
    const top = cat.parent?.name ?? cat.name;
    const signed = sign(inv) * inv.netAmount;
    realByCategory[top] = (realByCategory[top] ?? 0) + signed;
    realBySpecific[cat.name] = (realBySpecific[cat.name] ?? 0) + signed;
  }

  const conceptDeviations: CategoryDeviation[] = Object.entries(
    CATEGORY_TO_BREAKDOWN
  )
    .map(([catName, breakdownKey]) => {
      const presupuestado = budgetByType[breakdownKey] ?? 0;
      const real = realByCategory[catName] ?? 0;
      const pct = presupuestado > 0 ? (real / presupuestado) * 100 : 0;
      return { name: catName, presupuestado, real, pct };
    })
    .filter((d) => d.presupuestado > 0 || d.real > 0);

  const worstDeviation =
    conceptDeviations
      .filter((d) => d.presupuestado > 0)
      .sort((a, b) => b.pct - a.pct)[0] ?? null;

  // ── Avance obra ────────────────────────────────────────────────────────
  const latestPctByLineage = new Map<string, number>();
  for (const ep of project.estadosPago) {
    for (const item of ep.items) {
      const prev = latestPctByLineage.get(item.lineageId) ?? 0;
      if (item.pctAccumulated > prev)
        latestPctByLineage.set(item.lineageId, item.pctAccumulated);
    }
  }
  const presupuestoMO = obraItems.reduce(
    (s, i) => s + (i.costLabor ?? 0) * i.quantity,
    0
  );
  const moAcumulado = obraItems.reduce((s, i) => {
    const pct = latestPctByLineage.get(i.lineageId) ?? 0;
    return s + (i.costLabor ?? 0) * i.quantity * (pct / 100);
  }, 0);
  const avanceObraPct =
    presupuestoMO > 0 ? (moAcumulado / presupuestoMO) * 100 : 0;

  // ── Compromisos ───────────────────────────────────────────────────────
  const now = new Date();
  const overdue = facturasRecibidas.filter(
    (i) => i.status === "pendiente" && i.dueDate && i.dueDate < now
  );
  const invoicesOverdueCount = overdue.length;
  const invoicesOverdueAmount = overdue.reduce(
    (s, i) => s + i.totalAmount,
    0
  );
  const invoicesPendingCount = facturasRecibidas.filter(
    (i) => i.status === "pendiente"
  ).length;
  const draftEPsCount = project.estadosPago.filter(
    (ep) => ep.status === "borrador"
  ).length;

  // ── Alertas ───────────────────────────────────────────────────────────
  const alerts: ProjectAlert[] = [];
  for (const d of conceptDeviations) {
    if (d.presupuestado === 0) continue;
    if (d.pct >= 100) {
      alerts.push({
        severity: "danger",
        message: `${d.name}: ${d.pct.toFixed(0)}% del presupuesto consumido (excedido)`,
      });
    } else if (d.pct >= 80) {
      alerts.push({
        severity: "warning",
        message: `${d.name}: ${d.pct.toFixed(0)}% del presupuesto consumido`,
      });
    }
  }
  if (invoicesOverdueCount > 0) {
    alerts.push({
      severity: "danger",
      message: `${invoicesOverdueCount} factura${invoicesOverdueCount > 1 ? "s" : ""} vencida${invoicesOverdueCount > 1 ? "s" : ""} pendiente${invoicesOverdueCount > 1 ? "s" : ""} de pago`,
    });
  }
  // EP atrasado: proyecto en ejecución >60 días sin EP nuevo en los
  // últimos 30 días. Solo aplica si el proyecto tiene presupuesto MO
  // (sino no hay nada que avanzar).
  const projectStart = (project as { startDate: Date | null }).startDate ?? project.createdAt;
  const daysSinceStart = (now.getTime() - new Date(projectStart).getTime()) / (1000 * 60 * 60 * 24);
  if (presupuestoMO > 0 && daysSinceStart > 60) {
    const lastEPDate = project.estadosPago.length > 0
      ? new Date(
          Math.max(...project.estadosPago.map((ep) => new Date(ep.date).getTime()))
        )
      : null;
    const daysSinceLastEP = lastEPDate
      ? (now.getTime() - lastEPDate.getTime()) / (1000 * 60 * 60 * 24)
      : Infinity;
    if (daysSinceLastEP > 30) {
      alerts.push({
        severity: "warning",
        message: lastEPDate
          ? `Sin EP nuevo hace ${Math.floor(daysSinceLastEP)} días`
          : `Sin EPs cargados aún (proyecto activo hace ${Math.floor(daysSinceStart)} días)`,
      });
    }
  }

  return {
    versionLabels: {
      obra: obra?.version,
      muebles: muebles?.version,
      artefactos: artefactos?.version,
    },
    totalAcordado,
    totalAcordadoNeto,
    totalCobrado,
    totalCobradoNeto,
    totalGastado,
    totalGastadoConIva,
    utilidadReal,
    utilidadProyectada,
    pctCobrado,
    avanceObraPct,
    conceptDeviations,
    worstDeviation,
    // Agregaciones brutas, expuestas para que callers (ej resumen/page.tsx)
    // construyan vistas más complejas (EERR jerárquico) sin re-recorrer
    // las facturas.
    budgetByType,
    realByCategory,
    realBySpecific,
    invoicesOverdueCount,
    invoicesOverdueAmount,
    invoicesPendingCount,
    draftEPsCount,
    alerts,
  };
}
