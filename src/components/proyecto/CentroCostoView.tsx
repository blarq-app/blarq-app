import Link from "next/link";
import { formatCLP } from "@/lib/utils";

// Vista del Resumen para "centros de costo internos" (isInternal = true).
// La vista normal de proyecto (Total acordado / Cobrado / Utilidad / etc)
// no aplica acá porque no se le factura a ningún cliente externo. En
// cambio mostramos: tendencia mensual de gasto, distribución por
// categoría (con sub-totales), top proveedores y facturas pendientes.

type Invoice = {
  id: string;
  type: string;
  netAmount: number;
  totalAmount: number;
  status: string;
  issueDate: Date;
  dueDate: Date | null;
  businessName: string | null;
  rutIssuer: string | null;
  category: { name: string; parent: { name: string } | null } | null;
};

export default function CentroCostoView({
  project,
}: {
  project: {
    id: string;
    name: string;
    clientName: string;
    invoices: Invoice[];
  };
}) {
  // ── Filtrar facturas relevantes (recibidas — gastos de la empresa) ────
  const facturas = project.invoices.filter((i) => i.type === "recibida");

  // ── Tendencia mensual ─────────────────────────────────────────────────
  // Agrupamos por YYYY-MM. Ordenado del más antiguo al más reciente.
  const byMonth = new Map<string, { total: number; count: number }>();
  for (const inv of facturas) {
    const d = new Date(inv.issueDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const cur = byMonth.get(key) ?? { total: 0, count: 0 };
    cur.total += inv.netAmount;
    cur.count++;
    byMonth.set(key, cur);
  }
  const months = Array.from(byMonth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, v]) => ({ key, ...v }));

  const maxMonth = months.reduce((m, x) => Math.max(m, x.total), 0);

  // Cards: gasto del mes, promedio, por pagar, variación
  const today = new Date();
  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthKey = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}`;

  const gastoMesActual = byMonth.get(currentMonthKey)?.total ?? 0;
  const gastoMesAnterior = byMonth.get(lastMonthKey)?.total ?? 0;
  const promedioMensual =
    months.length > 0
      ? months.reduce((s, m) => s + m.total, 0) / months.length
      : 0;
  const porPagar = facturas
    .filter((i) => i.status === "pendiente")
    .reduce((s, i) => s + i.totalAmount, 0);

  const variacionPct =
    gastoMesAnterior > 0
      ? ((gastoMesActual - gastoMesAnterior) / gastoMesAnterior) * 100
      : 0;

  // ── Distribución por categoría (jerárquica top → sub) ─────────────────
  type CatNode = { name: string; total: number; count: number; subs: CatNode[] };
  const topMap = new Map<string, CatNode>();
  for (const inv of facturas) {
    const cat = inv.category;
    if (!cat) continue;
    const topName = cat.parent?.name ?? cat.name;
    const subName = cat.parent ? cat.name : null;

    let top = topMap.get(topName);
    if (!top) {
      top = { name: topName, total: 0, count: 0, subs: [] };
      topMap.set(topName, top);
    }
    top.total += inv.netAmount;
    top.count++;

    if (subName) {
      let sub = top.subs.find((s) => s.name === subName);
      if (!sub) {
        sub = { name: subName, total: 0, count: 0, subs: [] };
        top.subs.push(sub);
      }
      sub.total += inv.netAmount;
      sub.count++;
    }
  }
  const categorias = Array.from(topMap.values()).sort((a, b) => b.total - a.total);
  for (const c of categorias) c.subs.sort((a, b) => b.total - a.total);
  const totalGastado = categorias.reduce((s, c) => s + c.total, 0);

  // ── Top proveedores ───────────────────────────────────────────────────
  const provMap = new Map<string, { total: number; count: number }>();
  for (const inv of facturas) {
    const key = (inv.businessName || inv.rutIssuer || "(sin emisor)").trim();
    const cur = provMap.get(key) ?? { total: 0, count: 0 };
    cur.total += inv.netAmount;
    cur.count++;
    provMap.set(key, cur);
  }
  const topProveedores = Array.from(provMap.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  // ── Facturas vencidas o por vencer (próximos 7 días) ─────────────────
  today.setHours(0, 0, 0, 0);
  const sevenDays = new Date(today);
  sevenDays.setDate(sevenDays.getDate() + 7);
  const vencidasOPorVencer = facturas
    .filter(
      (i) =>
        i.status === "pendiente" && i.dueDate && new Date(i.dueDate) <= sevenDays
    )
    .sort((a, b) => (a.dueDate!.getTime() - b.dueDate!.getTime()))
    .slice(0, 8);

  return (
    <div>
      {/* Cards arriba — métricas relevantes para centro de costo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat
          label="Gasto del mes"
          value={formatCLP(gastoMesActual)}
          sub={months.length > 0 ? formatMonthEs(currentMonthKey) : "sin data"}
        />
        <Stat
          label="Promedio mensual"
          value={formatCLP(promedioMensual)}
          sub={`${months.length} mes${months.length !== 1 ? "es" : ""} con data`}
        />
        <Stat
          label="Por pagar"
          value={formatCLP(porPagar)}
          sub="facturas pendientes (c/IVA)"
          tone={porPagar > 0 ? "text-red-600" : undefined}
        />
        <Stat
          label="Variación mes ant."
          value={
            gastoMesAnterior > 0
              ? `${variacionPct > 0 ? "+" : ""}${variacionPct.toFixed(0)}%`
              : "—"
          }
          sub={
            gastoMesAnterior > 0
              ? formatCLP(gastoMesAnterior) + " mes anterior"
              : "sin mes anterior"
          }
          tone={
            variacionPct > 20
              ? "text-red-600"
              : variacionPct < -20
                ? "text-green-600"
                : undefined
          }
        />
      </div>

      {/* Tendencia mensual */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
          Tendencia mensual <span className="text-[10px] text-gray-400 normal-case">neto</span>
        </h2>
        {months.length === 0 ? (
          <p className="text-sm text-gray-500">No hay facturas cargadas.</p>
        ) : (
          <div className="space-y-2">
            {months.map((m) => (
              <div key={m.key} className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-20 tabular-nums">
                  {formatMonthEs(m.key)}
                </span>
                <div className="flex-1 bg-gray-100 rounded-full h-5 relative overflow-hidden">
                  <div
                    className={`h-5 rounded-full ${
                      m.key === currentMonthKey ? "bg-gray-900" : "bg-gray-500"
                    }`}
                    style={{ width: `${maxMonth > 0 ? (m.total / maxMonth) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-sm tabular-nums text-gray-900 w-28 text-right font-medium">
                  {formatCLP(m.total)}
                </span>
                <span className="text-xs text-gray-400 w-16 text-right">
                  {m.count} fra{m.count !== 1 ? "s" : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Distribución por categoría */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
          Distribución por categoría <span className="text-[10px] text-gray-400 normal-case">acumulado neto</span>
        </h2>
        {categorias.length === 0 ? (
          <p className="text-sm text-gray-500">Sin gastos categorizados.</p>
        ) : (
          <div className="space-y-1">
            {categorias.map((c) => {
              const pct = totalGastado > 0 ? (c.total / totalGastado) * 100 : 0;
              return (
                <div key={c.name}>
                  <div className="flex items-center gap-3 py-1">
                    <span className="text-sm font-medium text-gray-900 w-44 truncate">{c.name}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2">
                      <div
                        className="bg-gray-700 h-2 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-sm tabular-nums text-gray-900 w-28 text-right font-medium">
                      {formatCLP(c.total)}
                    </span>
                    <span className="text-xs text-gray-500 w-12 text-right">
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                  {/* Subs */}
                  {c.subs.length > 0 && (
                    <div className="ml-6 space-y-0.5">
                      {c.subs.map((s) => {
                        const subPct = c.total > 0 ? (s.total / c.total) * 100 : 0;
                        return (
                          <div key={s.name} className="flex items-center gap-3 py-0.5 text-xs">
                            <span className="text-gray-500 w-40 truncate">▸ {s.name}</span>
                            <span className="flex-1"></span>
                            <span className="tabular-nums text-gray-700 w-24 text-right">
                              {formatCLP(s.total)}
                            </span>
                            <span className="text-gray-400 w-12 text-right">
                              {subPct.toFixed(0)}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="flex items-center gap-3 pt-3 mt-2 border-t-2 border-gray-300 font-bold text-gray-900">
              <span className="text-sm w-44 uppercase tracking-wider">Total</span>
              <span className="flex-1"></span>
              <span className="text-sm tabular-nums w-28 text-right">{formatCLP(totalGastado)}</span>
              <span className="text-xs text-gray-500 w-12 text-right">100%</span>
            </div>
          </div>
        )}
      </div>

      {/* Top proveedores + Facturas pendientes en grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
            Top proveedores
          </h2>
          {topProveedores.length === 0 ? (
            <p className="text-sm text-gray-500">No hay proveedores aún.</p>
          ) : (
            <div className="space-y-1">
              {topProveedores.map((p) => (
                <div key={p.name} className="flex items-center justify-between py-1.5 text-sm">
                  <span className="text-gray-900 truncate flex-1 min-w-0 mr-3">
                    {p.name}
                  </span>
                  <span className="tabular-nums text-gray-700 w-24 text-right font-medium">
                    {formatCLP(p.total)}
                  </span>
                  <span className="text-xs text-gray-400 w-14 text-right">
                    {p.count} fra{p.count !== 1 ? "s" : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
            Vencidas / Por vencer (7d)
          </h2>
          {vencidasOPorVencer.length === 0 ? (
            <p className="text-sm text-gray-500">Nada urgente.</p>
          ) : (
            <div className="space-y-1">
              {vencidasOPorVencer.map((inv) => {
                const dueDate = new Date(inv.dueDate!);
                const isOverdue = dueDate < today;
                return (
                  <Link
                    key={inv.id}
                    href={`/facturas/${inv.id}`}
                    className="flex items-center justify-between py-1.5 text-sm hover:bg-gray-50 rounded px-2 -mx-2"
                  >
                    <span className={`truncate flex-1 min-w-0 mr-3 ${isOverdue ? "text-red-700" : "text-gray-900"}`}>
                      {inv.businessName || inv.rutIssuer || "—"}
                    </span>
                    <span className="tabular-nums text-gray-700 w-24 text-right font-medium">
                      {formatCLP(inv.totalAmount)}
                    </span>
                    <span className={`text-xs w-20 text-right tabular-nums ${isOverdue ? "text-red-600 font-medium" : "text-gray-400"}`}>
                      {dueDate.toLocaleDateString("es-CL", { day: "2-digit", month: "short" })}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Link al listado completo */}
      <div className="text-center">
        <Link
          href={`/proyectos/${project.id}/facturas`}
          className="text-sm text-gray-700 hover:text-gray-900 underline"
        >
          Ver todas las facturas → ({facturas.length})
        </Link>
      </div>
    </div>
  );
}

function formatMonthEs(key: string): string {
  // key = "2026-04"
  const [y, m] = key.split("-");
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${months[parseInt(m, 10) - 1]} ${y.slice(2)}`;
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`text-xl font-bold mt-1 tabular-nums ${tone ?? "text-gray-900"}`}>
        {value}
      </p>
      <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>
    </div>
  );
}
