import * as React from "react";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { formatCLP, OBRA_CHAPTERS, ObraChapter } from "@/lib/utils";
import Link from "next/link";
import CentroCostoView from "@/components/proyecto/CentroCostoView";
import { computeProjectMetrics } from "@/lib/projects/metrics";
import { computeFondoSueldos, type ProjectWithFondo } from "@/lib/banco/fondoSueldos";
import FondoSueldosCard from "@/components/proyecto/FondoSueldosCard";

// Mapa: nombre de CostCategory -> campo de desglose en ObraItem
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

export default async function ResultadosPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      invoices: {
        include: { category: { include: { parent: true } } },
      },
      budgetVersions: {
        include: {
          obraItems: true,
          muebleChapters: { include: { items: true } },
          artefactoItems: true,
          paymentTerms: { orderBy: { sortOrder: "asc" } },
        },
      },
      estadosPago: {
        include: { items: true },
      },
    },
  });

  if (!project) notFound();

  // Si el proyecto es un centro de costo interno (BLARQ, etc), mostramos
  // una vista distinta — las métricas de proyecto-cliente (Total acordado,
  // Cobrado, Utilidad, Presupuesto vs Real) no aplican.
  if (project.isInternal) {
    return <CentroCostoView project={project} searchParams={sp} />;
  }

  // ── Métricas contables (fuente única: metrics.ts) ──────────────────────
  // Antes esto se calculaba duplicado acá, lo que causó el bug del IVA del
  // 29-abr (se arregló en metrics y la pantalla seguía mal). Ahora todo
  // viene de computeProjectMetrics — los tests en scripts/test-metrics.ts
  // garantizan que estos números no van a divergir en silencio.
  const m = computeProjectMetrics(project);
  const {
    totalAcordado: totalVendido,
    totalCobrado,
    totalGastado,
    totalPagadoMaestros,
    utilidadReal,
    pctCobrado,
    budgetByType,
    realByCategory: realByTop,
    realBySpecific,
  } = m;
  const margenReal = totalCobrado > 0 ? (utilidadReal / totalCobrado) * 100 : 0;

  // ── Versions (lookups locales — no son cálculo, solo navegación al
  // nodo del árbol para acceder a obraItems / muebleChapters / etc).
  function bestVersion<T extends { status: string; createdAt: Date }>(arr: T[]) {
    const aprobado = arr
      .filter((b) => b.status === "aprobado")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return aprobado ?? arr.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  }
  const lastObra = bestVersion(project.budgetVersions.filter((b) => b.type === "obra"));
  const lastMuebles = bestVersion(project.budgetVersions.filter((b) => b.type === "muebles"));
  const lastArtefactos = bestVersion(project.budgetVersions.filter((b) => b.type === "artefactos"));

  // Aliases para mantener compatibilidad con el resto del archivo
  const obraItems = lastObra?.obraItems ?? [];
  const mueblesAllItems = lastMuebles
    ? lastMuebles.muebleChapters.flatMap((c) => c.items)
    : [];
  // (obraTotal/mueblesTotal/artefactosTotal se borraron porque ya no se
  // usan en el JSX — la sección "Desglose por tipo" se eliminó en commit
  // c5c6000. totalVendido viene de metrics.totalAcordado.)

  const facturasRecibidas = project.invoices.filter((i) => i.type === "recibida");

  // ── Construir secciones jerárquicas para tabla "Presupuesto vs Real" ──
  // Estructura: 3 secciones (Obra, Muebles, Artefactos), cada una con sus
  // sub-conceptos y un subtotal. Total general al final.
  type ResumenRow = { label: string; presupuesto: number; real: number };
  type ResumenSection = { title: string; rows: ResumenRow[] };

  // 1) OBRA — conceptos del costo directo
  const obraSection: ResumenSection = {
    title: "1. Obra",
    rows: [
      { label: "Materiales", presupuesto: budgetByType.costMaterial, real: realByTop["Materiales"] || 0 },
      {
        label: "Mano de obra",
        presupuesto: budgetByType.costLabor,
        real: (realByTop["Mano de obra"] || 0) + totalPagadoMaestros,
      },
      { label: "Herramientas", presupuesto: budgetByType.costTools, real: realByTop["Herramientas"] || 0 },
      { label: "Subcontrato", presupuesto: budgetByType.costSubcontract, real: realByTop["Subcontrato"] || 0 },
      { label: "Pérdidas", presupuesto: budgetByType.costLoss, real: realByTop["Pérdidas"] || 0 },
    ],
  };

  // 2) MUEBLES — agrupar items del presupuesto por sub (Mueble / Herrajes / Cubiertas)
  function muebleNameToSub(name: string): "Mueble" | "Herrajes" | "Cubiertas" {
    const u = (name || "").toUpperCase();
    if (u.includes("CUBIERTA")) return "Cubiertas";
    if (u.includes("HERRAJ")) return "Herrajes";
    return "Mueble";
  }
  const mueblesPresupBySub = { Mueble: 0, Herrajes: 0, Cubiertas: 0 };
  for (const it of mueblesAllItems) {
    mueblesPresupBySub[muebleNameToSub(it.name)] += it.costDistributor * it.quantity;
  }
  const mueblesSection: ResumenSection = {
    title: "2. Muebles",
    rows: [
      { label: "Mueble", presupuesto: mueblesPresupBySub.Mueble, real: realBySpecific["Mueble"] || 0 },
      { label: "Herrajes", presupuesto: mueblesPresupBySub.Herrajes, real: realBySpecific["Herrajes"] || 0 },
      { label: "Cubiertas", presupuesto: mueblesPresupBySub.Cubiertas, real: realBySpecific["Cubiertas"] || 0 },
    ],
  };
  // Si hay facturas categorizadas al top "Muebles" sin sub, agregar fila visible
  const mueblesSinClasificar = realBySpecific["Muebles"] || 0;
  if (mueblesSinClasificar > 0) {
    mueblesSection.rows.push({ label: "(Sin subcategoría)", presupuesto: 0, real: mueblesSinClasificar });
  }

  // 3) ARTEFACTOS — agrupar por subcategory del item (sanitario→Baño, cocina→Cocina, iluminacion→Iluminación)
  function artefactoSubToCat(sub: string): "Cocina" | "Baño" | "Iluminación" {
    if (sub === "iluminacion") return "Iluminación";
    if (sub === "sanitario") return "Baño";
    return "Cocina";
  }
  const artefactosPresupBySub = { Cocina: 0, Baño: 0, Iluminación: 0 };
  if (lastArtefactos) {
    for (const it of lastArtefactos.artefactoItems) {
      artefactosPresupBySub[artefactoSubToCat(it.subcategory)] += it.realCostBlarq || 0;
    }
  }
  const artefactosSection: ResumenSection = {
    title: "3. Artefactos",
    rows: [
      { label: "Cocina", presupuesto: artefactosPresupBySub.Cocina, real: realBySpecific["Cocina"] || 0 },
      { label: "Baño", presupuesto: artefactosPresupBySub.Baño, real: realBySpecific["Baño"] || 0 },
      { label: "Iluminación", presupuesto: artefactosPresupBySub.Iluminación, real: realBySpecific["Iluminación"] || 0 },
    ],
  };
  const artefactosSinClasificar = realBySpecific["Artefactos"] || 0;
  if (artefactosSinClasificar > 0) {
    artefactosSection.rows.push({ label: "(Sin subcategoría)", presupuesto: 0, real: artefactosSinClasificar });
  }

  const resumenSections: ResumenSection[] = [obraSection, mueblesSection, artefactosSection];

  // Subtotales y total general
  const sectionTotals = resumenSections.map((s) => ({
    presupuesto: s.rows.reduce((a, r) => a + r.presupuesto, 0),
    real: s.rows.reduce((a, r) => a + r.real, 0),
  }));
  const totalPresupuesto = sectionTotals.reduce((a, t) => a + t.presupuesto, 0);
  const totalReal = sectionTotals.reduce((a, t) => a + t.real, 0);

  // ==================== Avance por Capítulo (desde EPs) ====================
  // Último % por lineageId de cualquier EP (estable a través de versiones)
  const latestPctByLineage = new Map<string, number>();
  for (const ep of project.estadosPago) {
    for (const item of ep.items) {
      const prev = latestPctByLineage.get(item.lineageId) || 0;
      if (item.pctAccumulated > prev)
        latestPctByLineage.set(item.lineageId, item.pctAccumulated);
    }
  }

  const chapterRows = (Object.keys(OBRA_CHAPTERS) as ObraChapter[])
    .map((chapter) => {
      const items = obraItems.filter((i) => i.chapter === chapter);
      if (items.length === 0) return null;
      const presupuesto = items.reduce((s, i) => s + i.total, 0);
      const presupuestoMO = items.reduce(
        (s, i) => s + (i.costLabor ?? 0) * i.quantity,
        0
      );
      // % avance ponderado por MO (lo que se paga al maestro)
      let moAcumulado = 0;
      for (const item of items) {
        const pct = latestPctByLineage.get(item.lineageId) || 0;
        moAcumulado += (item.costLabor ?? 0) * item.quantity * (pct / 100);
      }
      const avance =
        presupuestoMO > 0 ? (moAcumulado / presupuestoMO) * 100 : 0;
      return {
        chapter,
        label: OBRA_CHAPTERS[chapter].label,
        index: OBRA_CHAPTERS[chapter].index,
        presupuesto,
        presupuestoMO,
        moAcumulado,
        avance,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.index - b.index);

  // (utilidadReal y margenReal vienen de computeProjectMetrics, declarados arriba)

  // ==================== Alertas ====================
  const now = new Date();
  const facturasVencidas = facturasRecibidas.filter(
    (i) => i.status === "pendiente" && i.dueDate && i.dueDate < now
  );
  const alertas: Array<{ severity: "danger" | "warning"; message: string }> = [];
  // Alertas sobre los conceptos de cada sección con presupuesto y desviación
  for (const section of resumenSections) {
    for (const r of section.rows) {
      if (r.presupuesto === 0) continue;
      const pct = (r.real / r.presupuesto) * 100;
      if (pct >= 100) {
        alertas.push({
          severity: "danger",
          message: `${r.label}: ${pct.toFixed(0)}% del presupuesto consumido (excedido)`,
        });
      } else if (pct >= 80) {
        alertas.push({
          severity: "warning",
          message: `${r.label}: ${pct.toFixed(0)}% del presupuesto consumido`,
        });
      }
    }
  }
  if (facturasVencidas.length > 0) {
    const monto = facturasVencidas.reduce((s, i) => s + i.totalAmount, 0);
    alertas.push({
      severity: "danger",
      message: `${facturasVencidas.length} factura${facturasVencidas.length > 1 ? "s" : ""} vencida${facturasVencidas.length > 1 ? "s" : ""} pendiente${facturasVencidas.length > 1 ? "s" : ""} de pago — ${formatCLP(monto)}`,
    });
  }

  // ==================== Desglose por categoría (tabla general) ====================
  const categories = await prisma.costCategory.findMany({
    where: { parentId: null },
    include: { children: true },
    orderBy: { sortOrder: "asc" },
  });
  const gastosPorCategoria = categories
    .map((cat) => {
      const catIds = [cat.id, ...cat.children.map((c) => c.id)];
      const total = facturasRecibidas
        .filter((i) => i.categoryId && catIds.includes(i.categoryId))
        .reduce((sum, i) => sum + i.totalAmount, 0);
      return { name: cat.name, total };
    })
    .filter((c) => c.total > 0);

  // ==================== Estado de Cobros al cliente ====================
  // Forma de pago del presupuesto aprobado de obra
  const paymentTerms = lastObra?.paymentTerms || [];
  // (totalAcordado y pctCobrado vienen de computeProjectMetrics arriba —
  // expuesto como `totalVendido` en este page para conservar el nombre antiguo.)
  const totalAcordado = totalVendido;
  const porCobrar = Math.max(0, totalAcordado - totalCobrado);

  const barColor = (pct: number) =>
    pct <= 80
      ? "bg-green-500"
      : pct <= 100
      ? "bg-yellow-500"
      : "bg-red-500";

  return (
    <div>
      {/* Badge de versión base */}
      {lastObra && (
        <div className="flex items-center gap-2 mb-5 text-xs text-gray-500">
          <span>Comparando contra:</span>
          <span className={`px-2 py-0.5 rounded font-medium ${lastObra.status === "aprobado" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
            Obra {lastObra.version} · {lastObra.status}
          </span>
          {lastMuebles && (
            <span className={`px-2 py-0.5 rounded font-medium ${lastMuebles.status === "aprobado" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
              Muebles {lastMuebles.version} · {lastMuebles.status}
            </span>
          )}
          {lastArtefactos && (
            <span className={`px-2 py-0.5 rounded font-medium ${lastArtefactos.status === "aprobado" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
              Artefactos {lastArtefactos.version} · {lastArtefactos.status}
            </span>
          )}
        </div>
      )}

      {/* Alertas */}
      {alertas.length > 0 && (
        <div className="mb-5 space-y-2">
          {alertas.map((a, i) => {
            const isDanger = a.severity === "danger";
            return (
              <div
                key={i}
                className={`rounded-lg px-4 py-2.5 flex items-center gap-3 text-sm ${
                  isDanger
                    ? "bg-red-50 border border-red-200 text-red-900"
                    : "bg-amber-50 border border-amber-200 text-amber-900"
                }`}
              >
                <span className={`text-lg ${isDanger ? "text-red-600" : "text-amber-700"}`}>
                  ⚠
                </span>
                <span>{a.message}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Cards resumen */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total acordado</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{formatCLP(totalVendido)}</p>
          <p className="text-xs text-gray-400 mt-0.5">c/IVA al cliente</p>
        </div>
        <div className="bg-white rounded-xl border border-blue-100 p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Cobrado</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{formatCLP(totalCobrado)}</p>
          <p className="text-xs text-gray-400 mt-0.5">{pctCobrado.toFixed(0)}% del total</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Gastado</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{formatCLP(totalGastado + totalPagadoMaestros)}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            neto, sin IVA
            {totalPagadoMaestros > 0 && ` · incl. ${formatCLP(totalPagadoMaestros)} EPs`}
          </p>
        </div>
        <div className={`bg-white rounded-xl border p-5 ${utilidadReal >= 0 ? "border-green-100" : "border-red-100"}`}>
          <p className="text-xs text-gray-500 uppercase tracking-wide">Utilidad real</p>
          <p className={`text-2xl font-bold mt-1 ${utilidadReal >= 0 ? "text-green-600" : "text-red-600"}`}>
            {formatCLP(utilidadReal)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">margen {margenReal.toFixed(1)}%</p>
        </div>
      </div>

      {/* Estado de cobros */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Estado de Cobros al Cliente</h2>
        <p className="text-xs text-gray-400 mb-4">Montos c/IVA — lo que el cliente paga</p>

        {/* Barra de progreso cobro */}
        <div className="mb-5">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">Cobrado: <span className="font-medium text-gray-900">{formatCLP(totalCobrado)}</span></span>
            <span className="text-gray-400">Por cobrar: <span className="font-medium text-orange-600">{formatCLP(porCobrar)}</span></span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-3">
            <div
              className="bg-blue-500 h-3 rounded-full transition-all"
              style={{ width: `${Math.min(pctCobrado, 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>0%</span>
            <span>{pctCobrado.toFixed(0)}% cobrado</span>
            <span>100%</span>
          </div>
        </div>

        {/* Forma de pago */}
        {paymentTerms.length > 0 ? (
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Forma de pago acordada</p>
            <div className="space-y-2">
              {paymentTerms.map((term, i) => {
                const amount = term.amount ?? (totalAcordado * term.percentage) / 100;
                // Estimamos si ya fue cobrado basándonos en cuánto se ha cobrado acumulado
                const cobradoAcumulado = paymentTerms.slice(0, i + 1).reduce((s, t) => {
                  return s + (t.amount ?? (totalAcordado * t.percentage) / 100);
                }, 0);
                const pagado = totalCobrado >= cobradoAcumulado;
                const parcial = !pagado && totalCobrado > (cobradoAcumulado - amount);
                return (
                  <div key={term.id} className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${pagado ? "bg-green-500 text-white" : parcial ? "bg-yellow-400 text-white" : "bg-gray-200 text-gray-400"}`}>
                      {pagado ? "✓" : i + 1}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-900">{term.stage}</span>
                        <span className="text-sm font-medium text-gray-900">{formatCLP(amount)}</span>
                      </div>
                      <div className="text-xs text-gray-400">{term.percentage}% del total</div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${pagado ? "bg-green-100 text-green-700" : parcial ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-500"}`}>
                      {pagado ? "cobrado" : parcial ? "parcial" : "pendiente"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400">
            No hay forma de pago definida en el presupuesto aprobado.
          </p>
        )}
      </div>

      {/* Presupuesto vs Real — tabla jerárquica con 3 secciones + total */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Presupuesto vs Real — Por Categoría
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-gray-500 border-b border-gray-200">
              <tr>
                <th className="text-left pb-2">Concepto</th>
                <th className="text-right pb-2">
                  Presupuestado
                  <span className="block text-[9px] text-gray-400 normal-case font-normal">neto</span>
                </th>
                <th className="text-right pb-2">
                  Real
                  <span className="block text-[9px] text-gray-400 normal-case font-normal">neto</span>
                </th>
                <th className="text-right pb-2">Desviación</th>
                <th className="text-left pb-2 pl-4 w-64">% Consumido</th>
              </tr>
            </thead>
            <tbody>
              {resumenSections.map((section, idx) => {
                const subtot = sectionTotals[idx];
                const subtotPct = subtot.presupuesto > 0
                  ? (subtot.real / subtot.presupuesto) * 100
                  : 0;
                return (
                  <React.Fragment key={section.title}>
                    {/* Header de sección */}
                    <tr className="bg-gray-50 border-t border-gray-200">
                      <td colSpan={5} className="py-1.5 px-2 text-xs uppercase tracking-wider font-semibold text-gray-700">
                        {section.title}
                      </td>
                    </tr>
                    {/* Sub-filas */}
                    {section.rows.map((r) => {
                      const pct = r.presupuesto > 0 ? (r.real / r.presupuesto) * 100 : 0;
                      return (
                        <tr key={r.label} className="border-t border-gray-100">
                          <td className="py-2 pl-4 text-gray-900">{r.label}</td>
                          <td className="py-2 text-right text-gray-700">
                            {r.presupuesto > 0 ? formatCLP(r.presupuesto) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="py-2 text-right text-gray-900 font-medium">
                            {r.real > 0 ? formatCLP(r.real) : <span className="text-gray-300">—</span>}
                          </td>
                          <td
                            className={`py-2 text-right font-medium ${
                              pct > 100 ? "text-red-600" : pct > 80 ? "text-yellow-600" : pct > 0 ? "text-green-600" : "text-gray-300"
                            }`}
                          >
                            {r.presupuesto > 0 ? `${pct.toFixed(0)}%` : "—"}
                          </td>
                          <td className="py-2 pl-4">
                            {r.presupuesto > 0 && (
                              <div className="w-full bg-gray-100 rounded-full h-2">
                                <div
                                  className={`h-2 rounded-full ${barColor(pct)}`}
                                  style={{ width: `${Math.min(pct, 100)}%` }}
                                />
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {/* Subtotal de sección */}
                    <tr className="border-t border-gray-200 text-gray-700">
                      <td className="py-1.5 pl-4 text-xs uppercase tracking-wider">Subtotal</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatCLP(subtot.presupuesto)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums font-medium text-gray-900">
                        {formatCLP(subtot.real)}
                      </td>
                      <td className="py-1.5 text-right">
                        {subtot.presupuesto > 0 ? `${subtotPct.toFixed(0)}%` : "—"}
                      </td>
                      <td></td>
                    </tr>
                  </React.Fragment>
                );
              })}
              {/* Total general */}
              <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold text-gray-900">
                <td className="py-2.5 pl-2 uppercase tracking-wider text-xs">Total general</td>
                <td className="py-2.5 text-right tabular-nums">
                  {formatCLP(totalPresupuesto)}
                </td>
                <td className="py-2.5 text-right tabular-nums">
                  {formatCLP(totalReal)}
                </td>
                <td className="py-2.5 text-right">
                  {totalPresupuesto > 0
                    ? `${((totalReal / totalPresupuesto) * 100).toFixed(0)}%`
                    : "—"}
                </td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          Mano de obra real = facturas recibidas categoría &quot;Mano de
          obra&quot; + pagos acumulados en EPs pagados.
        </p>
      </div>

      {/* Fondo Sueldos generado por este proyecto */}
      <FondoSueldosCard fondo={computeFondoSueldos(project as unknown as ProjectWithFondo)} />

      {/* Avance Obra por Capítulo (compacto, al final) */}
      {chapterRows.length > 0 && (
        <details className="bg-white rounded-xl border border-gray-200 p-4 mb-8 group">
          <summary className="cursor-pointer flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              Avance Obra por Capítulo
            </h2>
            <span className="text-xs text-gray-400 group-open:hidden">click para expandir</span>
            <span className="text-xs text-gray-400 hidden group-open:inline">click para colapsar</span>
          </summary>
          <div className="space-y-2 mt-4">
            {chapterRows.map((r) => (
              <div key={r.chapter} className="text-xs">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-gray-700">
                    {r.index}. {r.label}
                  </span>
                  <span className="text-gray-500 tabular-nums">
                    {r.avance.toFixed(0)}% — {formatCLP(r.moAcumulado)} / {formatCLP(r.presupuestoMO)} MO
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div
                    className="bg-gray-900 h-1.5 rounded-full"
                    style={{ width: `${Math.min(r.avance, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-3">
            El % de avance se calcula sobre la MO presupuestada según los %
            acumulados en los Estados de Pago del maestro.
          </p>
        </details>
      )}

      {/* (sección "Desglose por tipo" removida — su info ahora vive en
          la tabla "Presupuesto vs Real — Por Categoría" más arriba) */}

      {/* Desglose de gastos por categoría */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Desglose de Gastos Reales (facturas recibidas)
        </h2>
        {gastosPorCategoria.length === 0 ? (
          <p className="text-gray-500 text-sm">
            No hay gastos registrados con categoría asignada.
          </p>
        ) : (
          <div className="space-y-2">
            {gastosPorCategoria.map((cat) => (
              <div
                key={cat.name}
                className="flex items-center justify-between py-2 border-b border-gray-50"
              >
                <span className="text-sm text-gray-700">{cat.name}</span>
                <div className="flex items-center gap-4">
                  <div className="w-48 bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-gray-900 h-2 rounded-full"
                      style={{
                        width: `${Math.min(
                          (cat.total / totalGastado) * 100,
                          100
                        )}%`,
                      }}
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-900 w-28 text-right">
                    {formatCLP(cat.total)}
                  </span>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between py-2 font-bold">
              <span>Total</span>
              <span>{formatCLP(totalGastado)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
