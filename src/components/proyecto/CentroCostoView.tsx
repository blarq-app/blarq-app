import Link from "next/link";
import { formatCLP } from "@/lib/utils";
import { computePeriodRange, type Period } from "@/lib/periods";
import PeriodSelector from "@/components/proyecto/PeriodSelector";

// Vista del Resumen para "centros de costo internos" (isInternal = true).
// La vista normal de proyecto (Total acordado / Cobrado / Utilidad / etc)
// no aplica acá porque no se le factura a ningún cliente externo. En
// cambio mostramos un Estado de Resultados estructurado con período
// seleccionable y comparación contra período anterior.

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

// Mapeo: top categoría → sección del EERR.
// Cualquier categoría no listada cae en "Otros".
// Las facturas con categoryId=null caen en "Sin categoría" (sección visual
// distinguida en itálica gris) — coincide con el render del listado.
const SECTION_BY_TOP: Record<string, string> = {
  "Gastos generales": "Gastos generales",
  "Auto": "Vehículos",
  "Herramientas": "Equipamiento",
  "Materiales": "Insumos",
  "Gastos financieros": "Gastos financieros",
  "Mano de obra": "Mano de obra",
  "Subcontrato": "Subcontratos",
};

const UNCATEGORIZED_SECTION = "Sin categoría";

const SECTION_ORDER = [
  "Gastos generales",
  "Vehículos",
  "Equipamiento",
  "Insumos",
  "Mano de obra",
  "Subcontratos",
  "Gastos financieros",
  "Otros",
  UNCATEGORIZED_SECTION,
];

export default function CentroCostoView({
  project,
  searchParams,
}: {
  project: {
    id: string;
    name: string;
    clientName: string;
    invoices: Invoice[];
  };
  searchParams: {
    period?: string;
    from?: string;
    to?: string;
  };
}) {
  // ── Período actual y anterior ────────────────────────────────────────
  const period: Period =
    searchParams.period === "quarter" ||
    searchParams.period === "ytd" ||
    searchParams.period === "year" ||
    searchParams.period === "custom"
      ? searchParams.period
      : "month";

  const range = computePeriodRange(period, searchParams.from, searchParams.to);

  const facturas = project.invoices.filter((i) => i.type === "recibida");

  function inRange(d: Date, start: Date, end: Date): boolean {
    return d >= start && d <= end;
  }

  const facturasCurrent = facturas.filter((i) =>
    inRange(new Date(i.issueDate), range.current.start, range.current.end)
  );
  const facturasPrevious = facturas.filter((i) =>
    inRange(new Date(i.issueDate), range.previous.start, range.previous.end)
  );

  // ── EERR: agrupar por sección y luego por sub ───────────────────────
  type Sub = { name: string; current: number; previous: number };
  type Section = { name: string; subs: Map<string, Sub> };

  const sectionsMap = new Map<string, Section>();
  for (const sectionName of SECTION_ORDER) {
    sectionsMap.set(sectionName, { name: sectionName, subs: new Map() });
  }

  function addToSection(inv: Invoice, periodKey: "current" | "previous") {
    const cat = inv.category;
    const top = cat?.parent?.name ?? cat?.name ?? null;
    const sub = cat?.parent ? cat.name : null;

    const sectionName = top
      ? (SECTION_BY_TOP[top] ?? "Otros")
      : UNCATEGORIZED_SECTION;
    const section = sectionsMap.get(sectionName)!;

    // Si la categoría tiene parent → la sub se llama como cat.name.
    // Si no tiene parent → la "sub" es el mismo nombre del top.
    // Si no hay categoría → cae en "Sin categoría" sin desglose.
    const subKey = sub ?? top ?? UNCATEGORIZED_SECTION;

    let s = section.subs.get(subKey);
    if (!s) {
      s = { name: subKey, current: 0, previous: 0 };
      section.subs.set(subKey, s);
    }
    s[periodKey] += inv.netAmount;
  }

  for (const inv of facturasCurrent) addToSection(inv, "current");
  for (const inv of facturasPrevious) addToSection(inv, "previous");

  // Filtrar secciones vacías
  const sections = SECTION_ORDER.map((name) => sectionsMap.get(name)!).filter(
    (s) =>
      Array.from(s.subs.values()).some(
        (sub) => sub.current > 0 || sub.previous > 0
      )
  );

  const totalCurrent = facturasCurrent.reduce((s, i) => s + i.netAmount, 0);
  const totalPrevious = facturasPrevious.reduce((s, i) => s + i.netAmount, 0);
  const totalVar = pctVar(totalCurrent, totalPrevious);

  // ── Métricas para cards arriba ──────────────────────────────────────
  // Por pagar (a hoy, no del período): facturas pendientes c/IVA
  const porPagar = facturas
    .filter((i) => i.status === "pendiente")
    .reduce((s, i) => s + i.totalAmount, 0);

  // ── Tendencia mensual (últimos 12 meses) ────────────────────────────
  const byMonth = new Map<string, { total: number; count: number }>();
  for (const inv of facturas) {
    const d = new Date(inv.issueDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const cur = byMonth.get(key) ?? { total: 0, count: 0 };
    cur.total += inv.netAmount;
    cur.count++;
    byMonth.set(key, cur);
  }
  const allMonths = Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const monthsToShow = allMonths.slice(-12);
  const maxMonth = monthsToShow.reduce((m, [, v]) => Math.max(m, v.total), 0);
  const today = new Date();
  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  // ── Top proveedores del período actual ──────────────────────────────
  const provMap = new Map<string, { total: number; count: number }>();
  for (const inv of facturasCurrent) {
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

  // ── Vencidas / por vencer ───────────────────────────────────────────
  const todayMid = new Date();
  todayMid.setHours(0, 0, 0, 0);
  const sevenDays = new Date(todayMid);
  sevenDays.setDate(sevenDays.getDate() + 7);
  const vencidas = facturas
    .filter(
      (i) =>
        i.status === "pendiente" && i.dueDate && new Date(i.dueDate) <= sevenDays
    )
    .sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime())
    .slice(0, 8);

  return (
    <div>
      {/* Selector de período */}
      <PeriodSelector
        currentPeriod={period}
        fromLabel={range.current.label}
        toLabel={
          period === "month" || period === "year"
            ? range.current.label
            : range.current.end.toLocaleDateString("es-CL", {
                day: "2-digit",
                month: "short",
                year: "2-digit",
              })
        }
      />

      {/* Cards arriba */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat
          label="Total del período"
          value={formatCLP(totalCurrent)}
          sub={`${facturasCurrent.length} facturas`}
        />
        <Stat
          label="Período anterior"
          value={formatCLP(totalPrevious)}
          sub={range.previous.label}
        />
        <Stat
          label="Variación"
          value={
            totalPrevious > 0
              ? `${totalVar > 0 ? "+" : ""}${totalVar.toFixed(0)}%`
              : "—"
          }
          sub={
            totalPrevious > 0
              ? `${formatCLP(totalCurrent - totalPrevious)} dif.`
              : "sin comparable"
          }
          tone={
            totalVar > 20
              ? "text-red-600"
              : totalVar < -20
                ? "text-green-600"
                : undefined
          }
        />
        <Stat
          label="Por pagar"
          value={formatCLP(porPagar)}
          sub="pendiente a proveedores (c/IVA)"
          tone={porPagar > 0 ? "text-red-600" : undefined}
        />
      </div>

      {/* Estado de Resultados */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-1">
          Estado de Resultados
        </h2>
        <p className="text-xs text-gray-400 mb-4">
          Gastos del período · montos en neto (sin IVA)
        </p>
        {sections.length === 0 ? (
          <p className="text-sm text-gray-500">
            No hay gastos en este período. Probá ampliar el rango con &quot;YTD&quot; o
            &quot;Año&quot;.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
              <tr>
                <th className="text-left pb-2 w-1/2">Concepto</th>
                <th className="text-right pb-2">{range.current.label}</th>
                <th className="text-right pb-2">{range.previous.label}</th>
                <th className="text-right pb-2 w-20">Var %</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((section) => {
                const subs = Array.from(section.subs.values()).sort(
                  (a, b) => b.current - a.current
                );
                const sectionCurrent = subs.reduce((s, x) => s + x.current, 0);
                const sectionPrev = subs.reduce((s, x) => s + x.previous, 0);
                const sectionVar = pctVar(sectionCurrent, sectionPrev);
                // Si solo hay 1 sub, no la mostramos como fila aparte:
                // la fila de sección ya muestra el total y la sub única
                // es redundante.
                const showSubs = subs.length > 1;

                return (
                  <SectionBlock
                    key={section.name}
                    name={section.name}
                    subs={showSubs ? subs : []}
                    sectionCurrent={sectionCurrent}
                    sectionPrev={sectionPrev}
                    sectionVar={sectionVar}
                    dim={section.name === UNCATEGORIZED_SECTION}
                  />
                );
              })}
              {/* Total general */}
              <tr className="border-t-2 border-gray-300 bg-gray-50">
                <td className="pl-2 py-2.5 font-bold text-gray-900 uppercase tracking-wider text-xs">
                  Total
                </td>
                <td className="text-right py-2.5 font-bold tabular-nums text-gray-900">
                  {formatCLP(totalCurrent)}
                </td>
                <td className="text-right py-2.5 tabular-nums text-gray-700">
                  {formatCLP(totalPrevious)}
                </td>
                <td className="text-right py-2.5 font-bold tabular-nums">
                  <VarCell pct={totalVar} hasComparable={totalPrevious > 0} />
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* Tendencia mensual (siempre últimos 12 meses, independiente del filtro) */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-1">
          Tendencia mensual{" "}
          <span className="text-[10px] text-gray-400 normal-case">neto</span>
        </h2>
        <p className="text-xs text-gray-400 mb-4">Últimos 12 meses con data</p>
        {monthsToShow.length === 0 ? (
          <p className="text-sm text-gray-500">No hay facturas cargadas.</p>
        ) : (
          <div className="space-y-2">
            {monthsToShow.map(([key, v]) => (
              <div key={key} className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-20 tabular-nums">
                  {formatMonthEs(key)}
                </span>
                <div className="flex-1 bg-gray-100 rounded-full h-5 relative overflow-hidden">
                  <div
                    className={`h-5 rounded-full ${
                      key === currentMonthKey ? "bg-gray-900" : "bg-gray-500"
                    }`}
                    style={{
                      width: `${maxMonth > 0 ? (v.total / maxMonth) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="text-sm tabular-nums text-gray-900 w-28 text-right font-medium">
                  {formatCLP(v.total)}
                </span>
                <span className="text-xs text-gray-400 w-16 text-right">
                  {v.count} fra{v.count !== 1 ? "s" : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top proveedores + Vencidas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-1">
            Top proveedores
          </h2>
          <p className="text-xs text-gray-400 mb-4">{range.current.label}</p>
          {topProveedores.length === 0 ? (
            <p className="text-sm text-gray-500">
              Sin proveedores en este período.
            </p>
          ) : (
            <div className="space-y-1">
              {topProveedores.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center justify-between py-1.5 text-sm"
                >
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
            Vencidas / por vencer (7d)
          </h2>
          {vencidas.length === 0 ? (
            <p className="text-sm text-gray-500">Nada urgente.</p>
          ) : (
            <div className="space-y-1">
              {vencidas.map((inv) => {
                const dueDate = new Date(inv.dueDate!);
                const isOverdue = dueDate < todayMid;
                return (
                  <Link
                    key={inv.id}
                    href={`/facturas/${inv.id}`}
                    className="flex items-center justify-between py-1.5 text-sm hover:bg-gray-50 rounded px-2 -mx-2"
                  >
                    <span
                      className={`truncate flex-1 min-w-0 mr-3 ${
                        isOverdue ? "text-red-700" : "text-gray-900"
                      }`}
                    >
                      {inv.businessName || inv.rutIssuer || "—"}
                    </span>
                    <span className="tabular-nums text-gray-700 w-24 text-right font-medium">
                      {formatCLP(inv.totalAmount)}
                    </span>
                    <span
                      className={`text-xs w-20 text-right tabular-nums ${
                        isOverdue ? "text-red-600 font-medium" : "text-gray-400"
                      }`}
                    >
                      {dueDate.toLocaleDateString("es-CL", {
                        day: "2-digit",
                        month: "short",
                      })}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

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

function SectionBlock({
  name,
  subs,
  sectionCurrent,
  sectionPrev,
  sectionVar,
  dim,
}: {
  name: string;
  subs: Array<{ name: string; current: number; previous: number }>;
  sectionCurrent: number;
  sectionPrev: number;
  sectionVar: number;
  dim?: boolean;
}) {
  const labelClass = dim
    ? "pl-2 py-1.5 italic text-gray-400"
    : "pl-2 py-1.5 font-medium text-gray-900";
  const amountClass = dim
    ? "text-right py-1.5 tabular-nums italic text-gray-400"
    : "text-right py-1.5 tabular-nums font-medium text-gray-900";
  return (
    <>
      <tr className="border-t border-gray-100">
        <td className={labelClass}>{name}</td>
        <td className={amountClass}>
          {formatCLP(sectionCurrent)}
        </td>
        <td className="text-right py-1.5 tabular-nums text-gray-600">
          {formatCLP(sectionPrev)}
        </td>
        <td className="text-right py-1.5 tabular-nums">
          <VarCell pct={sectionVar} hasComparable={sectionPrev > 0} />
        </td>
      </tr>
      {subs.map((sub) => {
        const subVar = pctVar(sub.current, sub.previous);
        return (
          <tr key={sub.name} className="text-xs">
            <td className="pl-6 py-1 text-gray-500">▸ {sub.name}</td>
            <td className="text-right py-1 tabular-nums text-gray-700">
              {sub.current > 0 ? formatCLP(sub.current) : <span className="text-gray-300">—</span>}
            </td>
            <td className="text-right py-1 tabular-nums text-gray-500">
              {sub.previous > 0 ? formatCLP(sub.previous) : <span className="text-gray-300">—</span>}
            </td>
            <td className="text-right py-1 tabular-nums">
              <VarCell pct={subVar} hasComparable={sub.previous > 0} dim />
            </td>
          </tr>
        );
      })}
    </>
  );
}

function VarCell({
  pct,
  hasComparable,
  dim,
}: {
  pct: number;
  hasComparable: boolean;
  dim?: boolean;
}) {
  if (!hasComparable) {
    return <span className="text-gray-300">—</span>;
  }
  const arrow = pct > 0 ? "↑" : pct < 0 ? "↓" : "·";
  const color =
    pct > 20
      ? "text-red-600"
      : pct < -20
        ? "text-green-600"
        : dim
          ? "text-gray-400"
          : "text-gray-600";
  return (
    <span className={color}>
      {arrow} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

function pctVar(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

function formatMonthEs(key: string): string {
  const [y, m] = key.split("-");
  const months = [
    "ene", "feb", "mar", "abr", "may", "jun",
    "jul", "ago", "sep", "oct", "nov", "dic",
  ];
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
