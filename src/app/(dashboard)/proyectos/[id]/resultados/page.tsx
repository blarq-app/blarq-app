import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { formatCLP, OBRA_CHAPTERS, ObraChapter } from "@/lib/utils";
import Link from "next/link";

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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      invoices: {
        include: { category: { include: { parent: true } } },
      },
      budgetVersions: {
        include: {
          obraItems: true,
          muebleItems: true,
          artefactoItems: true,
        },
      },
      estadosPago: {
        include: { items: true },
      },
    },
  });

  if (!project) notFound();

  // Último presupuesto de cada tipo
  const lastObra = project.budgetVersions
    .filter((b) => b.type === "obra")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const lastMuebles = project.budgetVersions
    .filter((b) => b.type === "muebles")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const lastArtefactos = project.budgetVersions
    .filter((b) => b.type === "artefactos")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  // Presupuestado — OBRA
  const obraCostoDirecto = lastObra
    ? lastObra.obraItems.reduce((sum, i) => sum + i.total, 0)
    : 0;
  const obraGG = obraCostoDirecto * ((lastObra?.ggPercentage || 0) / 100);
  const obraSubtotal = obraCostoDirecto + obraGG;
  const obraUtilidad =
    obraSubtotal * ((lastObra?.utilityPercentage || 0) / 100);
  const obraNeto = obraSubtotal + obraUtilidad;
  const obraTotal = obraNeto * 1.19;

  const mueblesTotal = lastMuebles
    ? lastMuebles.muebleItems.reduce((sum, i) => sum + i.clientPriceIva, 0)
    : 0;
  const mueblesCosto = lastMuebles
    ? lastMuebles.muebleItems.reduce((sum, i) => sum + i.costDistributor, 0)
    : 0;

  const artefactosTotal = lastArtefactos
    ? lastArtefactos.artefactoItems.reduce((sum, i) => sum + i.clientPrice, 0)
    : 0;
  const artefactosCosto = lastArtefactos
    ? lastArtefactos.artefactoItems.reduce(
        (sum, i) => sum + (i.realCostBlarq || 0),
        0
      )
    : 0;

  const totalVendido = obraTotal + mueblesTotal + artefactosTotal;

  const facturasEmitidas = project.invoices.filter(
    (i) => i.type === "emitida"
  );
  const totalCobrado = facturasEmitidas.reduce(
    (sum, i) => sum + i.totalAmount,
    0
  );
  const facturasRecibidas = project.invoices.filter(
    (i) => i.type === "recibida"
  );
  const totalGastado = facturasRecibidas.reduce(
    (sum, i) => sum + i.totalAmount,
    0
  );

  // ==================== Presupuesto vs Real por Tipo de Concepto ====================
  // Presupuesto: suma del desglose de ObraItem por cada campo (cantidad × costField)
  const obraItems = lastObra?.obraItems || [];
  const budgetByType: Record<string, number> = {
    costMaterial: 0,
    costLabor: 0,
    costTools: 0,
    costSubcontract: 0,
    costLoss: 0,
  };
  for (const item of obraItems) {
    budgetByType.costMaterial +=
      (item.costMaterial ?? 0) * item.quantity;
    budgetByType.costLabor += (item.costLabor ?? 0) * item.quantity;
    budgetByType.costTools += (item.costTools ?? 0) * item.quantity;
    budgetByType.costSubcontract +=
      (item.costSubcontract ?? 0) * item.quantity;
    budgetByType.costLoss += (item.costLoss ?? 0) * item.quantity;
  }

  // Real: suma de facturas recibidas agrupadas por nombre de categoría padre
  const realByCategory: Record<string, number> = {};
  for (const inv of facturasRecibidas) {
    const topCatName = inv.category?.parent?.name || inv.category?.name;
    if (!topCatName) continue;
    realByCategory[topCatName] =
      (realByCategory[topCatName] || 0) + inv.totalAmount;
  }
  // Sumarle los pagos a maestros (EPs) como MO real
  const totalPagadoMaestros = project.estadosPago
    .filter((ep) => ep.status === "pagado")
    .reduce((sum, ep) => {
      const prev = project.estadosPago
        .filter((p) => p.number < ep.number && p.status === "pagado")
        .flatMap((p) => p.items);
      const prevMap = new Map<string, number>();
      prev.forEach((i) =>
        prevMap.set(
          i.obraItemId,
          Math.max(prevMap.get(i.obraItemId) || 0, i.pctAccumulated)
        )
      );
      const thisAmount = ep.items.reduce((s, i) => {
        const prevPct = prevMap.get(i.obraItemId) || 0;
        return s + i.laborTotal * ((i.pctAccumulated - prevPct) / 100);
      }, 0);
      return sum + thisAmount;
    }, 0);

  const conceptRows = [
    { key: "costMaterial", label: "Materiales", catName: "Materiales" },
    { key: "costLabor", label: "Mano de obra", catName: "Mano de obra" },
    { key: "costTools", label: "Herramientas", catName: "Herramientas" },
    {
      key: "costSubcontract",
      label: "Subcontrato",
      catName: "Subcontrato",
    },
    { key: "costLoss", label: "Pérdidas", catName: "Pérdidas" },
  ].map((row) => {
    const presupuesto = budgetByType[row.key] || 0;
    let real = realByCategory[row.catName] || 0;
    if (row.key === "costLabor") real += totalPagadoMaestros;
    const desviacion = presupuesto > 0 ? (real / presupuesto) * 100 : 0;
    return { ...row, presupuesto, real, desviacion };
  });

  // ==================== Avance por Capítulo (desde EPs) ====================
  // Último % por obraItemId de cualquier EP
  const latestPctByItem = new Map<string, number>();
  for (const ep of project.estadosPago) {
    for (const item of ep.items) {
      const prev = latestPctByItem.get(item.obraItemId) || 0;
      if (item.pctAccumulated > prev)
        latestPctByItem.set(item.obraItemId, item.pctAccumulated);
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
        const pct = latestPctByItem.get(item.id) || 0;
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

  const utilidadReal = totalCobrado - totalGastado - totalPagadoMaestros;
  const margenReal =
    totalCobrado > 0 ? (utilidadReal / totalCobrado) * 100 : 0;

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

  const barColor = (pct: number) =>
    pct <= 80
      ? "bg-green-500"
      : pct <= 100
      ? "bg-yellow-500"
      : "bg-red-500";

  return (
    <div>
      <div className="flex items-center gap-3 mb-8">
        <Link
          href={`/proyectos/${project.id}`}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          {project.name}
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-bold text-gray-900">
          Estado de Resultados
        </h1>
      </div>

      {/* Cards resumen */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Presupuestado</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {formatCLP(totalVendido)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Cobrado</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">
            {formatCLP(totalCobrado)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Gastado (costos + EPs)</p>
          <p className="text-2xl font-bold text-red-600 mt-1">
            {formatCLP(totalGastado + totalPagadoMaestros)}
          </p>
          {totalPagadoMaestros > 0 && (
            <p className="text-xs text-gray-500 mt-0.5">
              Incluye {formatCLP(totalPagadoMaestros)} de EPs pagados
            </p>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Utilidad Real</p>
          <p
            className={`text-2xl font-bold mt-1 ${
              utilidadReal >= 0 ? "text-green-600" : "text-red-600"
            }`}
          >
            {formatCLP(utilidadReal)}
          </p>
          <p className="text-sm text-gray-500 mt-0.5">
            Margen: {margenReal.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Presupuesto vs Real por Tipo de Concepto */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Presupuesto vs Real — Por Tipo de Concepto
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-gray-500 border-b border-gray-200">
              <tr>
                <th className="text-left pb-2">Concepto</th>
                <th className="text-right pb-2">Presupuestado</th>
                <th className="text-right pb-2">Real</th>
                <th className="text-right pb-2">Desviación</th>
                <th className="text-left pb-2 pl-4 w-64">% Consumido</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {conceptRows.map((r) => (
                <tr key={r.key}>
                  <td className="py-2 text-gray-900">{r.label}</td>
                  <td className="py-2 text-right text-gray-700">
                    {formatCLP(r.presupuesto)}
                  </td>
                  <td className="py-2 text-right text-gray-900 font-medium">
                    {formatCLP(r.real)}
                  </td>
                  <td
                    className={`py-2 text-right font-medium ${
                      r.desviacion > 100
                        ? "text-red-600"
                        : r.desviacion > 80
                        ? "text-yellow-600"
                        : "text-green-600"
                    }`}
                  >
                    {r.presupuesto > 0 ? `${r.desviacion.toFixed(0)}%` : "—"}
                  </td>
                  <td className="py-2 pl-4">
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${barColor(
                          r.desviacion
                        )}`}
                        style={{
                          width: `${Math.min(r.desviacion, 150)}%`,
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          Mano de obra real = facturas recibidas categoría &quot;Mano de
          obra&quot; + pagos acumulados en EPs pagados.
        </p>
      </div>

      {/* Avance por Capítulo */}
      {chapterRows.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Avance Obra por Capítulo
          </h2>
          <div className="space-y-3">
            {chapterRows.map((r) => (
              <div key={r.chapter}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-gray-900 font-medium">
                    {r.index}. {r.label}
                  </span>
                  <span className="text-gray-700">
                    {formatCLP(r.moAcumulado)} /{" "}
                    <span className="text-gray-500">
                      {formatCLP(r.presupuestoMO)} MO
                    </span>{" "}
                    <span className="ml-2 text-gray-500">
                      ({r.avance.toFixed(0)}%)
                    </span>
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className="bg-gray-900 h-2 rounded-full"
                    style={{ width: `${Math.min(r.avance, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-3">
            El % de avance se calcula sobre la MO presupuestada según los %
            acumulados en los Estados de Pago del maestro.
          </p>
        </div>
      )}

      {/* Desglose por tipo (Obra / Muebles / Artefactos) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-3">Obra</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Presupuestado</span>
              <span className="font-medium">{formatCLP(obraTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Costo Directo</span>
              <span>{formatCLP(obraCostoDirecto)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">
                GG ({lastObra?.ggPercentage || 0}%)
              </span>
              <span>{formatCLP(obraGG)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">
                Utilidad ({lastObra?.utilityPercentage || 0}%)
              </span>
              <span>{formatCLP(obraUtilidad)}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-3">Muebles</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Vendido al Cliente</span>
              <span className="font-medium">{formatCLP(mueblesTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Costo BLARQ</span>
              <span>{formatCLP(mueblesCosto)}</span>
            </div>
            <div className="flex justify-between text-green-700 font-medium">
              <span>Utilidad</span>
              <span>{formatCLP(mueblesTotal - mueblesCosto)}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-3">Artefactos</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Vendido al Cliente</span>
              <span className="font-medium">
                {formatCLP(artefactosTotal)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Costo Real BLARQ</span>
              <span>{formatCLP(artefactosCosto)}</span>
            </div>
            <div className="flex justify-between text-green-700 font-medium">
              <span>Utilidad</span>
              <span>{formatCLP(artefactosTotal - artefactosCosto)}</span>
            </div>
          </div>
        </div>
      </div>

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
