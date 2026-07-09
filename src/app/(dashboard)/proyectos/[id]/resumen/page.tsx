import * as React from "react";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { formatCLP, OBRA_CHAPTERS, ObraChapter } from "@/lib/utils";
import Link from "next/link";
import CentroCostoView, { type GastoExtra } from "@/components/proyecto/CentroCostoView";
import { esSocio } from "@/lib/banco/socios";
import { computeProjectMetrics } from "@/lib/projects/metrics";
import { selectVigente } from "@/lib/projects/selectVersion";

// Gastos de estructura de BLARQ que NO son factura, traídos del banco. Son
// movimientos categorizados a mano (sueldo / previred / comisión / impuestos).
// Se mapean a la misma forma que un gasto del Estado de Resultados para que el
// Resumen del proyecto BLARQ los muestre junto a las facturas. Solo egresos
// (amount < 0). Sueldo se sub-divide en Socios vs Empleados (MJ/JT vs el resto)
// con la misma definición de "socio" que usa el banco.
async function getGastosBancoBlarq(): Promise<GastoExtra[]> {
  const movs = await prisma.bankMovement.findMany({
    where: {
      category: { in: ["sueldo", "previred", "comision_bancaria", "impuestos"] },
      amount: { lt: 0 },
    },
    select: {
      amount: true,
      date: true,
      category: true,
      counterpartyRut: true,
      counterpartyName: true,
      description: true,
    },
  });
  return movs.map((m) => {
    let section = "Otros";
    let sub = "Otros";
    if (m.category === "sueldo") {
      section = "Sueldos";
      sub = esSocio(m.counterpartyRut, m.counterpartyName, m.description)
        ? "Socios"
        : "Empleados";
    } else if (m.category === "previred") {
      section = "Previred";
      sub = "Previred";
    } else if (m.category === "comision_bancaria") {
      section = "Gastos financieros";
      sub = "Comisión banco";
    } else if (m.category === "impuestos") {
      section = "Impuestos";
      sub = "Impuestos";
    }
    return {
      section,
      sub,
      amount: -m.amount, // monto positivo (costo)
      date: m.date,
      proveedor: m.counterpartyName ?? "—",
    };
  });
}
import { computeCuadroResumen, type CuadroResumenInput } from "@/lib/projects/cuadroResumen";
import ProjectAlerts from "@/components/proyecto/ProjectAlerts";
import CuadroResumenAvance from "@/components/proyecto/CuadroResumenAvance";

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
        omit: { pdfContent: true },
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
    // Solo el proyecto BLARQ (estructura del estudio) suma los gastos que NO
    // son factura: vienen del banco como movimientos categorizados. Así el
    // Resumen muestra TODO lo que cuesta operar BLARQ —sueldos (empleados y
    // socios), Previred, comisión banco, impuestos— y no solo las facturas.
    // Los retiros y préstamos de socios quedan FUERA (no son costo de operar,
    // son reparto/cuenta corriente). El resto de los centros internos (CASA)
    // no recibe estos gastos globales.
    const esBlarq = project.name.trim().toUpperCase() === "BLARQ";
    const extraGastos = esBlarq ? await getGastosBancoBlarq() : [];
    return (
      <CentroCostoView project={project} extraGastos={extraGastos} searchParams={sp} />
    );
  }

  // ── Lo ya transferido a la cuenta Sueldos por esta obra ────────────────
  // Suma NETA de las transferencias internas (Operativa→Sueldos) que MJ
  // concilió a esta obra. Contamos SOLO el lado que ENTRA a Sueldos
  // (bankAccount.role="salary_fund"); nunca los dos lados del par, o se
  // contaría el doble. Una devolución (Sueldos→Operativa) viene con monto
  // negativo en esa cuenta, así que netea sola. Es un dato aditivo: no toca
  // el cálculo del fondo "generado" (fondoSueldos.ts).
  // Separado por concepto (obra / muebles / sin clasificar) para que "Me paso a
  // Sueldos" muestre cuánto falta transferir de cada utilidad.
  const transferidoGroups = await prisma.bankMovement.groupBy({
    by: ["internalConcepto"],
    _sum: { amount: true },
    where: {
      projectId: id,
      category: "transfer_interno",
      bankAccount: { role: "salary_fund" },
    },
  });
  const transferido = { obra: 0, muebles: 0, sinConcepto: 0 };
  for (const g of transferidoGroups) {
    const v = g._sum.amount ?? 0;
    if (g.internalConcepto === "obra") transferido.obra += v;
    else if (g.internalConcepto === "muebles") transferido.muebles += v;
    else transferido.sinConcepto += v;
  }

  // Cuadro Resumen por concepto (fuente única): lo consume tanto la vista
  // CuadroResumen como la calculadora "Armar avance + Me paso a Sueldos".
  const cuadroData = computeCuadroResumen({
    invoices: project.invoices,
    budgets: project.budgetVersions,
  } as unknown as CuadroResumenInput);

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
    budgetBySubcategory,
  } = m;
  // Margen proyectado: utilidad / total acordado neto. La fórmula única
  // que MJ acordó: presupuestado − gastado, no cobrado − gastado.
  const margenProyectado =
    totalAcordadoNeto > 0 ? (utilidadProyectada / totalAcordadoNeto) * 100 : 0;

  // ── Versions (lookups locales — no son cálculo, solo navegación al
  // nodo del árbol para acceder a obraItems / muebleChapters / etc).
  // Criterio único de selección: selectVigente (ver selectVersion.ts).
  const lastObra = selectVigente(project.budgetVersions.filter((b) => b.type === "obra"));
  const lastMuebles = selectVigente(project.budgetVersions.filter((b) => b.type === "muebles"));
  const lastArtefactos = selectVigente(project.budgetVersions.filter((b) => b.type === "artefactos"));

  // Aliases para mantener compatibilidad con el resto del archivo
  const obraItems = lastObra?.obraItems ?? [];
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
  // Presupuesto por sub (Mueble / Herrajes / Cubiertas): viene de metrics.ts
  // (fuente única). Antes se calculaba acá con costDistributor; se movió a
  // computeProjectMetrics para no duplicar el criterio de costeo.
  const mueblesPresupBySub = budgetBySubcategory.muebles;
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
  // Presupuesto por sub (Cocina / Baño / Iluminación): viene de metrics.ts
  // (fuente única). Antes se calculaba acá con realCostBlarq; se movió a
  // computeProjectMetrics para no duplicar el criterio de costeo.
  const artefactosPresupBySub = budgetBySubcategory.artefactos;
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
  // Las alertas vienen de metrics.ts (fuente única: computeProjectMetrics)
  // — las mismas que usa el dashboard de inicio. Antes se recalculaban acá
  // por separado, lo que arriesgaba que dashboard y detalle mostraran
  // alertas distintas para el mismo proyecto (hallazgo A5). Cubren obra +
  // muebles + artefactos + facturas vencidas con monto.
  const alertas = m.alerts;

  // ==================== Desglose por categoría (tabla general) ====================
  const categories = await prisma.costCategory.findMany({
    where: { parentId: null },
    include: { children: true },
    orderBy: { sortOrder: "asc" },
  });
  // (El "Desglose de Gastos Reales por categoría" se eliminó 2026-06-16 —
  // era info repetida: lo mismo (gastos por categoría) ya está, y mejor, en
  // la tabla "Presupuesto vs Real — Por Categoría" que compara contra el
  // presupuesto. Se quitó tanto el cálculo como el bloque visual.)

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

      {/* Alertas de presupuesto — cada una se puede ocultar con la X. El
          cálculo de las alertas sigue en el server; ProjectAlerts solo las
          muestra y maneja el ocultar (ver ese componente). */}
      <ProjectAlerts projectId={project.id} alertas={alertas} />

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
      <CuadroResumenAvance
        data={cuadroData}
        transferido={transferido}
        projectId={id}
        projectName={project.name}
        objetivosGuardados={
          (project.avanceObjetivos as Record<string, number> | null) ?? null
        }
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

      {/* "Desglose de Gastos Reales" eliminado 2026-06-16 — info repetida:
          los gastos por categoría ya están, comparados contra presupuesto, en
          la tabla "Presupuesto vs Real — Por Categoría" de arriba. */}
    </div>
  );
}
