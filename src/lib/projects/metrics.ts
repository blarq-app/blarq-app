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

  // Resumen financiero (todos los montos en CLP)
  totalAcordado: number; // obra c/IVA + muebles + artefactos al cliente
  totalCobrado: number;
  totalGastado: number; // facturas recibidas + pagos a maestros
  totalPagadoMaestros: number;
  utilidadReal: number;
  pctCobrado: number; // 0..100+

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
// última creada si no hay aprobada.
function bestVersion<T extends { status: string; createdAt: Date }>(arr: T[]) {
  const aprobado = arr
    .filter((b) => b.status === "aprobado")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return (
    aprobado ??
    arr.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
  );
}

export function computeProjectMetrics(project: ProjectWithMetrics): ProjectMetrics {
  const obra = bestVersion(
    project.budgetVersions.filter((b) => b.type === "obra")
  );
  const muebles = bestVersion(
    project.budgetVersions.filter((b) => b.type === "muebles")
  );
  const artefactos = bestVersion(
    project.budgetVersions.filter((b) => b.type === "artefactos")
  );

  // ── Total acordado ────────────────────────────────────────────────────
  const obraCostoDirecto = obra
    ? obra.obraItems.reduce((s, i) => s + i.total, 0)
    : 0;
  const obraGG = obraCostoDirecto * ((obra?.ggPercentage ?? 0) / 100);
  const obraSubtotal = obraCostoDirecto + obraGG;
  const obraUtilidad = obraSubtotal * ((obra?.utilityPercentage ?? 0) / 100);
  const obraNeto = obraSubtotal + obraUtilidad;
  const obraTotal = obraNeto * 1.19;

  const mueblesTotal = muebles
    ? muebles.muebleChapters
        .flatMap((c) => c.items)
        .reduce((s, i) => s + i.clientPriceIva * i.quantity, 0)
    : 0;
  const artefactosTotal = artefactos
    ? artefactos.artefactoItems.reduce((s, i) => s + i.clientPrice, 0)
    : 0;

  const totalAcordado = obraTotal + mueblesTotal + artefactosTotal;

  // ── Cobrado / Gastado ─────────────────────────────────────────────────
  const facturasEmitidas = project.invoices.filter((i) => i.type === "emitida");
  const facturasRecibidas = project.invoices.filter(
    (i) => i.type === "recibida"
  );
  // Cobrado al cliente: c/IVA (es lo que efectivamente entra a caja).
  const totalCobrado = facturasEmitidas.reduce((s, i) => s + i.totalAmount, 0);
  // Gastado: NETO. El IVA pagado a proveedores se recupera como crédito
  // fiscal, así que el costo real de un insumo para BLARQ es el neto.
  // Comparar contra el presupuesto (que está en neto) requiere usar neto
  // también — sino el "real" sale inflado ~19% artificialmente.
  const totalRecibidoFacturas = facturasRecibidas.reduce(
    (s, i) => s + i.netAmount,
    0
  );

  // Pagos a maestros: solo de EPs cerrados
  const totalPagadoMaestros = project.estadosPago
    .filter((ep) => ep.status === "cerrado")
    .reduce(
      (s, ep) => s + ep.items.reduce((a, i) => a + (i.amountPaid ?? 0), 0),
      0
    );

  const totalGastado = totalRecibidoFacturas + totalPagadoMaestros;
  const utilidadReal = totalCobrado - totalGastado;
  const pctCobrado = totalAcordado > 0 ? (totalCobrado / totalAcordado) * 100 : 0;

  // ── Desviaciones por concepto interno ─────────────────────────────────
  const obraItems = obra?.obraItems ?? [];
  const budgetByType: Record<string, number> = {
    costMaterial: 0,
    costLabor: 0,
    costTools: 0,
    costSubcontract: 0,
    costLoss: 0,
  };
  for (const it of obraItems) {
    budgetByType.costMaterial += (it.costMaterial ?? 0) * it.quantity;
    budgetByType.costLabor += (it.costLabor ?? 0) * it.quantity;
    budgetByType.costTools += (it.costTools ?? 0) * it.quantity;
    budgetByType.costSubcontract += (it.costSubcontract ?? 0) * it.quantity;
    budgetByType.costLoss += (it.costLoss ?? 0) * it.quantity;
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
    realByCategory[top] = (realByCategory[top] ?? 0) + inv.netAmount;
    realBySpecific[cat.name] = (realBySpecific[cat.name] ?? 0) + inv.netAmount;
  }

  const conceptDeviations: CategoryDeviation[] = Object.entries(
    CATEGORY_TO_BREAKDOWN
  )
    .map(([catName, breakdownKey]) => {
      const presupuestado = budgetByType[breakdownKey] ?? 0;
      let real = realByCategory[catName] ?? 0;
      if (breakdownKey === "costLabor") real += totalPagadoMaestros;
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
    totalCobrado,
    totalGastado,
    totalPagadoMaestros,
    utilidadReal,
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
