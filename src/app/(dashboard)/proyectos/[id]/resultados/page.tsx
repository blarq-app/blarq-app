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

  // Presupuesto base: preferir el aprobado, si no el más reciente
  function bestVersion<T extends { status: string; createdAt: Date }>(arr: T[]) {
    const aprobado = arr.filter((b) => b.status === "aprobado").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return aprobado ?? arr.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  }
  const lastObra = bestVersion(project.budgetVersions.filter((b) => b.type === "obra"));
  const lastMuebles = bestVersion(project.budgetVersions.filter((b) => b.type === "muebles"));
  const lastArtefactos = bestVersion(project.budgetVersions.filter((b) => b.type === "artefactos"));

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

  const mueblesAllItems = lastMuebles
    ? lastMuebles.muebleChapters.flatMap((c) => c.items)
    : [];
  const mueblesTotal = mueblesAllItems.reduce(
    (sum, i) => sum + i.clientPriceIva * i.quantity,
    0
  );
  const mueblesCosto = mueblesAllItems.reduce(
    (sum, i) => sum + i.costDistributor * i.quantity,
    0
  );

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
          i.lineageId,
          Math.max(prevMap.get(i.lineageId) || 0, i.pctAccumulated)
        )
      );
      const thisAmount = ep.items.reduce((s, i) => {
        const prevPct = prevMap.get(i.lineageId) || 0;
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

  const utilidadReal = totalCobrado - totalGastado - totalPagadoMaestros;
  const margenReal =
    totalCobrado > 0 ? (utilidadReal / totalCobrado) * 100 : 0;

  // ==================== Alertas ====================
  const now = new Date();
  const facturasVencidas = facturasRecibidas.filter(
    (i) => i.status === "pendiente" && i.dueDate && i.dueDate < now
  );
  const alertas: Array<{ severity: "danger" | "warning"; message: string }> = [];
  for (const r of conceptRows) {
    if (r.presupuesto === 0) continue;
    if (r.desviacion >= 100) {
      alertas.push({
        severity: "danger",
        message: `${r.label}: ${r.desviacion.toFixed(0)}% del presupuesto consumido (excedido)`,
      });
    } else if (r.desviacion >= 80) {
      alertas.push({
        severity: "warning",
        message: `${r.label}: ${r.desviacion.toFixed(0)}% del presupuesto consumido`,
      });
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
  // Total acordado con cliente (obra + muebles + artefactos, c/IVA)
  const totalAcordado = totalVendido;
  // Cuánto falta cobrar
  const porCobrar = Math.max(0, totalAcordado - totalCobrado);
  // % cobrado del total
  const pctCobrado = totalAcordado > 0 ? (totalCobrado / totalAcordado) * 100 : 0;

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
          {totalPagadoMaestros > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">incl. {formatCLP(totalPagadoMaestros)} EPs</p>
          )}
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
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Estado de Cobros al Cliente</h2>

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
                        className={`h-2 rounded-full ${barColor(r.desviacion)}`}
                        style={{ width: `${Math.min(r.desviacion, 100)}%` }}
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
