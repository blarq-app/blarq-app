import * as React from "react";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { formatCLP, OBRA_CHAPTERS, ObraChapter } from "@/lib/utils";
import Link from "next/link";
import CentroCostoView from "@/components/proyecto/CentroCostoView";
import { computeProjectMetrics } from "@/lib/projects/metrics";
import { computeFondoSueldos, type ProjectWithFondo } from "@/lib/banco/fondoSueldos";
import FondoSueldosCard from "@/components/proyecto/FondoSueldosCard";
import CuadroResumen from "@/components/proyecto/CuadroResumen";

// Mapa: nombre de CostCategory -> campo de desglose en ObraItem.
// Margen NO está acá — es un componente del costo directo presupuestado
// (lo que MJ se queda como utilidad por partida) pero NO tiene contraparte
// en CostCategory porque las facturas reales no se categorizan como
// "Margen". Se renderiza igual en el resumen pero su columna "Real"
// queda en N/A — el margen real de un proyecto sale de cobrado − costos
// reales totales, no por partida.
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
        include: {
          category: { include: { parent: true } },
          payments: {
            include: { bankMovement: { select: { date: true } } },
          },
        },
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
      maestro: true,
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
    totalAcordadoNeto,
    totalCobrado,
    totalCobradoNeto,
    totalGastado,
    totalGastadoConIva,
    utilidadReal,
    utilidadProyectada,
    pctCobrado,
    budgetByType,
    realByCategory: realByTop,
    realBySpecific,
  } = m;
  // Margen proyectado: utilidad / total acordado neto. La fórmula única
  // que MJ acordó: presupuestado − gastado, no cobrado − gastado.
  const margenProyectado =
    totalAcordadoNeto > 0 ? (utilidadProyectada / totalAcordadoNeto) * 100 : 0;

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

  // 1) OBRA — conceptos del costo directo.
  // Margen: presupuestado se muestra (es lo que MJ se quedaba por partida
  // como utilidad). Real queda en "—" porque las facturas no se
  // categorizan como margen — el "margen real" del proyecto se mide a
  // nivel agregado (ver card "Utilidad Real"), no por partida.
  const obraSection: ResumenSection = {
    title: "1. Obra",
    rows: [
      { label: "Materiales", presupuesto: budgetByType.costMaterial, real: realByTop["Materiales"] || 0 },
      {
        label: "Mano de obra",
        presupuesto: budgetByType.costLabor,
        real: realByTop["Mano de obra"] || 0,
      },
      { label: "Herramientas", presupuesto: budgetByType.costTools, real: realByTop["Herramientas"] || 0 },
      { label: "Subcontrato", presupuesto: budgetByType.costSubcontract, real: realByTop["Subcontrato"] || 0 },
      { label: "Pérdidas", presupuesto: budgetByType.costLoss, real: realByTop["Pérdidas"] || 0 },
      { label: "Margen", presupuesto: budgetByType.costMargin, real: 0 },
    ],
  };

  // 2) MUEBLES — agrupar items del presupuesto por sub (Mueble / Herrajes / Cubiertas)
  // Convención BLARQ confirmada con MJ 2026-05-05: facturas categorizadas
  // como "Muebles" sin subcategoría son MUEBLE (la cuadrilla de Carlos
  // entrega el mueble armado completo, no se desagrega). Por eso ese real
  // se agrega a la fila "Mueble", no aparece como "(Sin subcategoría)".
  //
  // Presupuesto: usar costDistributor (lo que BLARQ paga al proveedor =
  // costo presupuestado real). Fallback a clientPriceNet si costDistributor
  // está vacío (asume "sin margen" implícito en ese item).
  function muebleNameToSub(name: string): "Mueble" | "Herrajes" | "Cubiertas" {
    const u = (name || "").toUpperCase();
    if (u.includes("CUBIERTA")) return "Cubiertas";
    if (u.includes("HERRAJ")) return "Herrajes";
    return "Mueble";
  }
  const mueblesPresupBySub = { Mueble: 0, Herrajes: 0, Cubiertas: 0 };
  for (const it of mueblesAllItems) {
    const costoPorUnidad =
      it.costDistributor > 0
        ? it.costDistributor
        : it.clientPriceNet > 0
          ? it.clientPriceNet
          : it.clientPriceIva / 1.19;
    mueblesPresupBySub[muebleNameToSub(it.name)] += costoPorUnidad * it.quantity;
  }
  // Real de "Muebles" top (sin sub específica) cuenta como "Mueble".
  const realMuebleTopSinSub = realBySpecific["Muebles"] || 0;
  const mueblesSection: ResumenSection = {
    title: "2. Muebles",
    rows: [
      {
        label: "Mueble",
        presupuesto: mueblesPresupBySub.Mueble,
        real: (realBySpecific["Mueble"] || 0) + realMuebleTopSinSub,
      },
      { label: "Herrajes", presupuesto: mueblesPresupBySub.Herrajes, real: realBySpecific["Herrajes"] || 0 },
      { label: "Cubiertas", presupuesto: mueblesPresupBySub.Cubiertas, real: realBySpecific["Cubiertas"] || 0 },
    ],
  };

  // 3) ARTEFACTOS — agrupar por subcategory del item.
  // Presupuesto: usar realCostBlarq (lo que BLARQ paga al proveedor =
  // costo presupuestado real). Fallback a clientPrice/1.19 si
  // realCostBlarq está vacío (asume "sin margen" — caso típico de
  // iluminación donde MJ no marca, simplemente cobra lo mismo que paga).
  function artefactoSubToCat(sub: string): "Cocina" | "Baño" | "Iluminación" {
    if (sub === "iluminacion") return "Iluminación";
    if (sub === "sanitario") return "Baño";
    return "Cocina";
  }
  const artefactosPresupBySub = { Cocina: 0, Baño: 0, Iluminación: 0 };
  if (lastArtefactos) {
    for (const it of lastArtefactos.artefactoItems) {
      const costoPorItem =
        it.realCostBlarq && it.realCostBlarq > 0
          ? it.realCostBlarq
          : (it.clientPrice ?? 0) / 1.19;
      artefactosPresupBySub[artefactoSubToCat(it.subcategory)] += costoPorItem;
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

  // 4) SIN CLASIFICAR — facturas recibidas asignadas al proyecto pero sin
  // ninguna categoría puesta. Antes quedaban afuera del desglose pero
  // sumaban en la card "Gastado" — eso generaba un mismatch visual entre
  // el subtotal del desglose y la card de arriba. Las explicitamos acá
  // para que MJ las catalogue. Misma convención de signo (NC=-1) y neto
  // que el resto del desglose.
  const sign = (i: { tipoDoc: number | null }) => (i.tipoDoc === 61 ? -1 : 1);
  const realSinCategoria = facturasRecibidas
    .filter((i) => !i.category)
    .reduce((s, i) => s + sign(i) * i.netAmount, 0);
  const sinClasificarSection: ResumenSection = {
    title: "4. Sin clasificar",
    rows: [{ label: "(Sin categoría)", presupuesto: 0, real: realSinCategoria }],
  };

  const resumenSections: ResumenSection[] = [obraSection, mueblesSection, artefactosSection];
  if (realSinCategoria > 0) resumenSections.push(sinClasificarSection);

  // Subtotales y total general
  const sectionTotals = resumenSections.map((s) => ({
    presupuesto: s.rows.reduce((a, r) => a + r.presupuesto, 0),
    real: s.rows.reduce((a, r) => a + r.real, 0),
  }));
  const totalPresupuesto = sectionTotals.reduce((a, t) => a + t.presupuesto, 0);
  const totalReal = sectionTotals.reduce((a, t) => a + t.real, 0);

  // "Gastos generales" no tiene presupuesto (no hay contraparte en
  // obraItems), pero el real existe y hoy quedaba fuera de la tabla —
  // generando un mismatch visual entre el subtotal y el card "Gastado".
  // Lo agregamos como fila suelta antes del total general, solo si hay
  // gasto.
  const gastosGeneralesReal = realByTop["Gastos generales"] || 0;
  const totalRealConGastosGen = totalReal + gastosGeneralesReal;

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

  // (utilidadProyectada y margenProyectado se declaran arriba)

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
  // Desglose en neto (consistente con la tabla y los cards de arriba) y
  // c/IVA mostrado como leyenda secundaria. Mismo signo de NCs que en
  // metrics.ts (tipoDoc=61 resta).
  const signGasto = (i: { tipoDoc: number | null }) => (i.tipoDoc === 61 ? -1 : 1);
  const gastosPorCategoria = categories
    .map((cat) => {
      const catIds = [cat.id, ...cat.children.map((c) => c.id)];
      const facturasCat = facturasRecibidas.filter(
        (i) => i.categoryId && catIds.includes(i.categoryId)
      );
      const total = facturasCat.reduce((s, i) => s + signGasto(i) * i.netAmount, 0);
      const totalConIva = facturasCat.reduce(
        (s, i) => s + signGasto(i) * i.totalAmount,
        0
      );
      return { name: cat.name, total, totalConIva };
    })
    .filter((c) => c.total > 0);
  const totalConIvaGastos = gastosPorCategoria.reduce((s, c) => s + c.totalConIva, 0);

  // (totalAcordado y pctCobrado vienen de computeProjectMetrics arriba —
  // expuesto como `totalVendido` en este page para conservar el nombre antiguo.)
  const totalAcordado = totalVendido;
  const porCobrar = Math.max(0, totalAcordado - totalCobrado);
  const porCobrarNeto = Math.max(0, totalAcordadoNeto - totalCobradoNeto);

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

      {/* Cards resumen — todas en NETO para que sean comparables entre sí.
          Total acordado, Cobrado, Por cobrar y Gastado: neto arriba con
          IVA en línea pequeña abajo. Utilidad ya es neto puro. */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total acordado</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{formatCLP(totalAcordadoNeto)}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            neto · {formatCLP(totalVendido)} c/IVA
          </p>
        </div>
        <div className="bg-white rounded-xl border border-blue-100 p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Cobrado</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{formatCLP(totalCobradoNeto)}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            neto · {formatCLP(totalCobrado)} c/IVA · {pctCobrado.toFixed(0)}% del total
          </p>
        </div>
        <div className={`bg-white rounded-xl border p-5 ${porCobrarNeto > 0 ? "border-orange-100" : "border-gray-200"}`}>
          <p className="text-xs text-gray-500 uppercase tracking-wide">Por cobrar</p>
          <p className={`text-2xl font-bold mt-1 ${porCobrarNeto > 0 ? "text-orange-600" : "text-gray-400"}`}>
            {formatCLP(porCobrarNeto)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            neto · {formatCLP(porCobrar)} c/IVA
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Gastado</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{formatCLP(totalGastado)}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            neto · {formatCLP(totalGastadoConIva)} c/IVA
          </p>
        </div>
        <div className={`bg-white rounded-xl border p-5 ${utilidadProyectada >= 0 ? "border-green-100" : "border-red-100"}`}>
          <p className="text-xs text-gray-500 uppercase tracking-wide">Utilidad</p>
          <p className={`text-2xl font-bold mt-1 ${utilidadProyectada >= 0 ? "text-green-600" : "text-red-600"}`}>
            {formatCLP(utilidadProyectada)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            margen {margenProyectado.toFixed(1)}% · acordado − gastado
          </p>
        </div>
      </div>

      {/* Bloque "Estado de Cobros al Cliente" eliminado 2026-05-15 — la
          info estaba duplicada con los cards arriba (Cobrado / Por cobrar)
          y con el Cuadro Resumen abajo (desglose por concepto + pagos). */}

      {/* Cuadro Resumen: acordado por concepto + transferencias conciliadas
          con facturas. Réplica del cuadro Excel que MJ lleva a mano.
          Va inmediatamente debajo de los cards porque es la vista
          "macro" del proyecto. */}
      <CuadroResumen
        invoices={project.invoices}
        budgets={project.budgetVersions}
      />

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
                <th className="text-right pb-2">
                  Diferencia
                  <span className="block text-[9px] text-gray-400 normal-case font-normal">presup − real</span>
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
                      <td colSpan={6} className="py-1.5 px-2 text-xs uppercase tracking-wider font-semibold text-gray-700">
                        {section.title}
                      </td>
                    </tr>
                    {/* Sub-filas */}
                    {section.rows.map((r) => {
                      const pct = r.presupuesto > 0 ? (r.real / r.presupuesto) * 100 : 0;
                      // Diferencia $ = presupuesto - real.
                      // Positivo = sobró (no se gastó todo el presupuesto),
                      // negativo = sobregasto.
                      // Margen y Pérdidas no se cargan como facturas en la
                      // realidad: su "real" siempre es 0 y la diferencia es
                      // todo el presupuesto. MJ pidió mostrar $0 explícito
                      // (no "—") para que la diferencia se calcule visible.
                      // Si hay presupuesto, mostramos real=$0 explícito y la
                      // diferencia calculada — incluso cuando no hay facturas
                      // todavía. Antes mostraba "—" para Materiales/MO/etc
                      // (incomparable visualmente con Margen/Pérdidas que sí
                      // muestran $0 forzado). Ahora consistente.
                      const tieneRealMapeable = r.presupuesto > 0 || r.real > 0;
                      const diff = r.presupuesto - r.real;
                      return (
                        <tr key={r.label} className="border-t border-gray-100">
                          <td className="py-2 pl-4 text-gray-900">{r.label}</td>
                          <td className="py-2 text-right text-gray-700">
                            {r.presupuesto > 0 ? formatCLP(r.presupuesto) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="py-2 text-right text-gray-900 font-medium">
                            {tieneRealMapeable
                              ? formatCLP(r.real)
                              : <span className="text-gray-300">—</span>}
                          </td>
                          <td
                            className={`py-2 text-right font-medium tabular-nums ${
                              !tieneRealMapeable
                                ? "text-gray-300"
                                : diff > 0
                                  ? "text-green-600"
                                  : diff < 0
                                    ? "text-red-600"
                                    : "text-gray-400"
                            }`}
                          >
                            {tieneRealMapeable
                              ? diff !== 0
                                ? `${diff > 0 ? "+" : ""}${formatCLP(diff)}`
                                : formatCLP(0)
                              : "—"}
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
                    {(() => {
                      const subtotDiff = subtot.presupuesto - subtot.real;
                      return (
                        <tr className="border-t border-gray-200 text-gray-700">
                          <td className="py-1.5 pl-4 text-xs uppercase tracking-wider">Subtotal</td>
                          <td className="py-1.5 text-right tabular-nums">
                            {formatCLP(subtot.presupuesto)}
                          </td>
                          <td className="py-1.5 text-right tabular-nums font-medium text-gray-900">
                            {formatCLP(subtot.real)}
                          </td>
                          <td
                            className={`py-1.5 text-right tabular-nums font-medium ${
                              subtot.real === 0
                                ? "text-gray-300"
                                : subtotDiff > 0
                                  ? "text-green-600"
                                  : subtotDiff < 0
                                    ? "text-red-600"
                                    : "text-gray-400"
                            }`}
                          >
                            {subtot.real > 0
                              ? `${subtotDiff > 0 ? "+" : ""}${formatCLP(subtotDiff)}`
                              : "—"}
                          </td>
                          <td className="py-1.5 text-right">
                            {subtot.presupuesto > 0 ? `${subtotPct.toFixed(0)}%` : "—"}
                          </td>
                          <td></td>
                        </tr>
                      );
                    })()}
                  </React.Fragment>
                );
              })}
              {/* Fila suelta: Gastos generales (sin sección porque no tiene
                  presupuesto y sería raro mostrar una sección con una sola
                  fila sin contraparte). Se renderiza solo si hay gasto. */}
              {gastosGeneralesReal > 0 && (
                <tr className="border-t border-gray-100">
                  <td className="py-2 pl-4 text-gray-900">Gastos generales</td>
                  <td className="py-2 text-right tabular-nums text-gray-400">—</td>
                  <td className="py-2 text-right tabular-nums font-medium text-gray-900">
                    {formatCLP(gastosGeneralesReal)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-gray-400">—</td>
                  <td className="py-2 text-right text-gray-400">—</td>
                  <td></td>
                </tr>
              )}
              {/* Total general */}
              {(() => {
                const totalDiff = totalPresupuesto - totalRealConGastosGen;
                return (
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold text-gray-900">
                    <td className="py-2.5 pl-2 uppercase tracking-wider text-xs">Total general</td>
                    <td className="py-2.5 text-right tabular-nums">
                      {formatCLP(totalPresupuesto)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">
                      {formatCLP(totalRealConGastosGen)}
                    </td>
                    <td
                      className={`py-2.5 text-right tabular-nums ${
                        totalRealConGastosGen === 0
                          ? "text-gray-300"
                          : totalDiff > 0
                            ? "text-green-600"
                            : totalDiff < 0
                              ? "text-red-600"
                              : "text-gray-400"
                      }`}
                    >
                      {totalRealConGastosGen > 0
                        ? `${totalDiff > 0 ? "+" : ""}${formatCLP(totalDiff)}`
                        : "—"}
                    </td>
                    <td className="py-2.5 text-right">
                      {totalPresupuesto > 0
                        ? `${((totalRealConGastosGen / totalPresupuesto) * 100).toFixed(0)}%`
                        : "—"}
                    </td>
                    <td></td>
                  </tr>
                );
              })()}
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
          Desglose de Gastos Reales (facturas recibidas, neto)
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
                  <div className="w-32 text-right">
                    <div className="text-sm font-medium text-gray-900 tabular-nums">
                      {formatCLP(cat.total)}
                    </div>
                    <div className="text-[10px] text-gray-400 tabular-nums">
                      c/IVA {formatCLP(cat.totalConIva)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between py-2 font-bold">
              <span>Total</span>
              <div className="text-right">
                <div className="tabular-nums">{formatCLP(totalGastado)}</div>
                <div className="text-[10px] text-gray-400 font-normal tabular-nums">
                  c/IVA {formatCLP(totalConIvaGastos)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
