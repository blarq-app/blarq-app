"use client";

import { useEffect, useRef, useState } from "react";
import { formatCLP } from "@/lib/utils";
import type {
  EstadoResultadoFacturacion,
  MonthBucket,
} from "@/lib/dashboard/estadoResultado";
import type { EstadoResultadoCaja } from "@/lib/dashboard/estadoResultadoCaja";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES_LARGO = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const CHART_H = 224; // alto del área de barras en px

type Vista = "facturacion" | "caja";

export default function EstadoResultadoChart({
  initialFacturacion,
  initialCaja,
}: {
  initialFacturacion: EstadoResultadoFacturacion;
  initialCaja: EstadoResultadoCaja;
}) {
  const [facturacion, setFacturacion] = useState(initialFacturacion);
  const [caja, setCaja] = useState(initialCaja);
  const [year, setYear] = useState(initialFacturacion.year);
  const [vista, setVista] = useState<Vista>("facturacion");
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<number | null>(null);

  async function cambiarAnio(nuevo: number) {
    setYear(nuevo);
    setLoading(true);
    setSel(null);
    try {
      const res = await fetch(`/api/dashboard/estado-resultado?year=${nuevo}`);
      if (res.ok) {
        const json = await res.json();
        setFacturacion(json.facturacion);
        setCaja(json.caja);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 mb-6">
      {/* Header */}
      <div className="flex items-end justify-between px-5 pt-4 pb-3 border-b border-gray-100">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            Estado de Resultado Anual
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {vista === "facturacion"
              ? "Solo facturas — lo que declarás al SII (F29) · montos con IVA"
              : "Plata real del banco — flujo de caja del estudio"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Toggle Facturación / Caja */}
          <div className="flex rounded-lg border border-gray-300 overflow-hidden text-xs">
            <button
              onClick={() => setVista("facturacion")}
              className={`px-3 py-1.5 transition-colors ${
                vista === "facturacion"
                  ? "bg-gray-900 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Facturación
            </button>
            <button
              onClick={() => setVista("caja")}
              className={`px-3 py-1.5 border-l border-gray-300 transition-colors ${
                vista === "caja"
                  ? "bg-gray-900 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Caja
            </button>
          </div>
          <select
            value={year}
            onChange={(e) => cambiarAnio(Number(e.target.value))}
            className="text-sm border border-gray-300 rounded px-2 py-1 text-gray-900 tabular-nums focus:outline-none focus:border-gray-500"
          >
            {facturacion.availableYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={loading ? "opacity-40 transition-opacity" : "transition-opacity"}>
        {vista === "facturacion" ? (
          <VistaFacturacion
            data={facturacion}
            year={year}
            sel={sel}
            setSel={setSel}
          />
        ) : (
          <VistaCaja data={caja} year={year} />
        )}
      </div>
    </div>
  );
}

/* ============================ VISTA FACTURACIÓN ============================ */

function VistaFacturacion({
  data,
  year,
  sel,
  setSel,
}: {
  data: EstadoResultadoFacturacion;
  year: number;
  sel: number | null;
  setSel: (n: number | null) => void;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartW, setChartW] = useState(0);
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setChartW(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { months } = data;
  const maxBar = Math.max(1, ...months.map((m) => Math.max(m.ingreso, m.egreso)));

  let lastActive = -1;
  months.forEach((m, i) => {
    if (m.ingreso !== 0 || m.egreso !== 0) lastActive = i;
  });

  // Escala de la línea de utilidad DEL MES (neto). Cero al medio, con aire.
  const accVals = months.slice(0, Math.max(lastActive + 1, 1)).map((m) => m.utilidadNeta);
  const accMax = Math.max(0, ...accVals) * 1.1;
  const accMin = Math.min(0, ...accVals) * 1.1;
  const accRange = accMax - accMin || 1;
  const yOf = (v: number) => CHART_H - ((v - accMin) / accRange) * CHART_H;
  const xOf = (i: number) => ((i + 0.5) / 12) * chartW;
  const yZero = yOf(0);

  const detalle: MonthBucket | null = sel !== null ? months[sel] : null;

  return (
    <div className="flex flex-col lg:flex-row">
      <div className="flex-1 px-5 py-4" onMouseLeave={() => setSel(null)}>
        <div ref={chartRef} className="relative" style={{ height: CHART_H }}>
          {accMin < 0 && (
            <div
              className="absolute left-0 right-0 border-t border-dashed border-gray-200"
              style={{ top: yZero }}
            />
          )}

          {/* Barras */}
          <div className="absolute inset-0 flex items-end">
            {months.map((m, i) => {
              const activo = sel === i;
              return (
                <div
                  key={m.month}
                  className="flex-1 h-full flex items-end justify-center gap-[3px]"
                  onMouseEnter={() => setSel(i)}
                >
                  <Bar valor={m.ingreso} max={maxBar} className={activo ? "bg-gray-700" : "bg-gray-500"} />
                  <Bar valor={m.egreso} max={maxBar} className={activo ? "bg-gray-400" : "bg-gray-200"} />
                </div>
              );
            })}
          </div>

          {/* Línea de utilidad del mes (neto) */}
          {chartW > 0 && lastActive >= 0 && (
            <svg className="absolute inset-0 pointer-events-none" width={chartW} height={CHART_H}>
              {months.slice(0, lastActive + 1).map((m, i) => {
                if (i === 0) return null;
                const prev = months[i - 1];
                const positivo = m.utilidadNeta >= 0;
                return (
                  <line
                    key={i}
                    x1={xOf(i - 1)}
                    y1={yOf(prev.utilidadNeta)}
                    x2={xOf(i)}
                    y2={yOf(m.utilidadNeta)}
                    stroke={positivo ? "#10b981" : "#fb7185"}
                    strokeWidth={2}
                  />
                );
              })}
              {months.slice(0, lastActive + 1).map((m, i) => {
                const positivo = m.utilidadNeta >= 0;
                return (
                  <circle
                    key={i}
                    cx={xOf(i)}
                    cy={yOf(m.utilidadNeta)}
                    r={sel === i ? 4 : 3}
                    fill={positivo ? "#10b981" : "#fb7185"}
                  />
                );
              })}
            </svg>
          )}
        </div>

        {/* Etiquetas de meses */}
        <div className="flex mt-1.5">
          {months.map((m, i) => (
            <div
              key={m.month}
              className={`flex-1 text-center text-[10px] tabular-nums ${
                sel === i ? "text-gray-900 font-medium" : "text-gray-400"
              }`}
            >
              {MESES[i]}
            </div>
          ))}
        </div>

        {/* Leyenda */}
        <div className="flex items-center gap-4 mt-3 text-[11px] text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-500" />
            Ingresos
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-200 border border-gray-300" />
            Egresos
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-0.5 bg-emerald-500" />
            Utilidad del mes (neto)
          </span>
        </div>
      </div>

      <PanelFacturacion year={year} mesIndex={sel} bucket={detalle} totales={data.totales} />
    </div>
  );
}

function Bar({ valor, max, className }: { valor: number; max: number; className: string }) {
  if (valor <= 0) return <div className="w-[42%]" />;
  const h = Math.max(2, (valor / max) * 100);
  return <div className={`w-[42%] rounded-t-sm ${className}`} style={{ height: `${h}%` }} />;
}

function PanelFacturacion({
  year,
  mesIndex,
  bucket,
  totales,
}: {
  year: number;
  mesIndex: number | null;
  bucket: MonthBucket | null;
  totales: EstadoResultadoFacturacion["totales"];
}) {
  const esAnio = bucket === null;
  const d = bucket ?? {
    ventas: totales.ventas,
    devoluciones: totales.devoluciones,
    ingreso: totales.ingreso,
    egresoPorCategoria: totales.egresoPorCategoria,
    egreso: totales.egreso,
    utilidadNeta: totales.utilidadNeta,
    ivaDebito: totales.ivaDebito,
    ivaCredito: totales.ivaCredito,
    ivaPagar: totales.ivaPagar,
  };

  const titulo = esAnio || mesIndex === null ? `Año ${year}` : `${MESES_LARGO[mesIndex]} ${year}`;
  const cats = Object.entries(d.egresoPorCategoria)
    .filter(([, v]) => v !== 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="lg:w-72 border-t lg:border-t-0 lg:border-l border-gray-100 px-5 py-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">{titulo}</h3>
        <span className="text-[10px] uppercase tracking-wider text-gray-400">
          {esAnio ? "Total año" : "Mes"}
        </span>
      </div>

      <Seccion titulo="Ingresos">
        <Fila label="Ventas" valor={d.ventas} />
        {d.devoluciones > 0 && <Fila label="Devoluciones" valor={-d.devoluciones} muted />}
        <FilaTotal label="Total ingresos" valor={d.ingreso} />
      </Seccion>

      <Seccion titulo="Egresos por categoría">
        {cats.length === 0 && <p className="text-sm text-gray-300">—</p>}
        {cats.map(([cat, v]) => (
          <Fila key={cat} label={cat} valor={v} />
        ))}
        <FilaTotal label="Total egresos" valor={d.egreso} />
      </Seccion>

      <div className="border-t border-gray-200 pt-3 mt-3 space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-gray-900">
            {esAnio ? "Utilidad del año" : "Utilidad del mes"}
            <span className="ml-1 text-[10px] font-normal text-gray-400">neto</span>
          </span>
          <span
            className={`text-sm font-bold tabular-nums ${
              d.utilidadNeta >= 0 ? "text-green-700" : "text-red-700"
            }`}
          >
            {formatCLP(d.utilidadNeta)}
          </span>
        </div>
      </div>

      {/* Bloque IVA / F29 */}
      <div className="border-t border-gray-200 pt-3 mt-3">
        <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">
          IVA · para el F29
        </p>
        <div className="space-y-1">
          <Fila label="IVA ventas (débito)" valor={d.ivaDebito} small />
          <Fila label="IVA compras (crédito)" valor={-d.ivaCredito} small muted />
          <div className="flex items-baseline justify-between text-sm border-t border-gray-100 pt-1 mt-1">
            <span className="font-medium text-gray-900">IVA a pagar</span>
            <span className="font-semibold tabular-nums text-gray-900">
              {formatCLP(d.ivaPagar)}
            </span>
          </div>
        </div>
      </div>

      {esAnio && (
        <p className="text-[11px] text-gray-400 mt-3 leading-snug">
          Pasá el mouse por un mes para ver su desglose.
        </p>
      )}
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">{titulo}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Fila({
  label,
  valor,
  muted,
  small,
}: {
  label: string;
  valor: number;
  muted?: boolean;
  small?: boolean;
}) {
  const cero = valor === 0;
  return (
    <div className={`flex items-baseline justify-between ${small ? "text-xs" : "text-sm"}`}>
      <span className={muted ? "text-gray-400" : "text-gray-600"}>{label}</span>
      <span
        className={`tabular-nums ${
          cero ? "text-gray-300" : muted ? "text-gray-400" : "text-gray-900"
        }`}
      >
        {formatCLP(valor)}
      </span>
    </div>
  );
}

function FilaTotal({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="flex items-baseline justify-between text-sm border-t border-gray-100 pt-1 mt-1">
      <span className="font-medium text-gray-900">{label}</span>
      <span className="font-semibold tabular-nums text-gray-900">{formatCLP(valor)}</span>
    </div>
  );
}

/* =============================== VISTA CAJA =============================== */

function VistaCaja({ data, year }: { data: EstadoResultadoCaja; year: number }) {
  return (
    <div className="px-5 py-4 overflow-x-auto">
      <table className="w-full text-xs tabular-nums border-collapse">
        <thead>
          <tr className="text-gray-500">
            <th className="text-left font-medium uppercase tracking-wider py-2 pr-3 sticky left-0 bg-white z-10">
              Detalle
            </th>
            {MESES.map((mes) => (
              <th key={mes} className="text-right font-medium uppercase tracking-wider py-2 px-2">
                {mes}
              </th>
            ))}
            <th className="text-right font-medium uppercase tracking-wider py-2 pl-3">
              Total {year}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          <FilaSeccion label="Ingresos" />
          {data.ingresoRows.map((r) => (
            <FilaCaja key={"i-" + r.label} row={r} positivo />
          ))}
          <FilaSeccion label="Egresos de operación" />
          {data.egresoRows.map((r) => (
            <FilaCaja key={"e-" + r.label} row={r} />
          ))}
        </tbody>
        <tfoot>
          <FilaTotalCaja
            label="Resultado de operación"
            monthly={data.resultadoOperacion}
            total={data.resultadoOperacionAnual}
            signo
            bold
            borderTop
          />
          {data.noOperativoRows.length > 0 && (
            <>
              <FilaSeccion label="No operativo (no es costo del negocio)" foot />
              {data.noOperativoRows.map((r) => (
                <FilaCaja key={"n-" + r.label} row={r} positivo={r.tipo === "ingreso"} />
              ))}
            </>
          )}
          <FilaTotalCaja
            label="Total mes (flujo real)"
            monthly={data.totalMes}
            total={data.totalAnual}
            signo
            bold
            borderTop
          />
          <FilaTotalCaja
            label="Acumulado"
            monthly={data.acumulado}
            total={data.acumulado[11]}
            signo
          />
        </tfoot>
      </table>
      <p className="text-[11px] text-gray-400 mt-3 leading-snug">
        Plata real del banco según la conciliación. El <span className="text-gray-500">resultado de
        operación</span> dice si el negocio gana; abajo, separados, los retiros de los socios y el
        pago de IVA (plata que sale pero no es costo de operar). &quot;No asignado&quot; = movimientos
        que todavía no catalogaste.
      </p>
    </div>
  );
}

function FilaSeccion({ label, foot }: { label: string; foot?: boolean }) {
  return (
    <tr>
      <td
        colSpan={14}
        className={`text-left text-[10px] uppercase tracking-wider text-gray-400 pt-3 pb-1 sticky left-0 bg-white ${
          foot ? "border-t border-gray-100" : ""
        }`}
      >
        {label}
      </td>
    </tr>
  );
}

// Color de un monto de caja: verde si es ingreso/positivo, rojo si es egreso/
// negativo, gris si es cero (el cero no ocupa espacio prominente).
function montoCaja(v: number, positivo: boolean): string {
  if (v === 0) return "text-gray-300";
  return positivo ? "text-green-700" : "text-red-600";
}

function FilaCaja({ row, positivo }: { row: { label: string; monthly: number[]; total: number }; positivo?: boolean }) {
  return (
    <tr className="hover:bg-gray-50">
      <td className="text-left text-gray-700 py-1.5 pr-3 sticky left-0 bg-white whitespace-nowrap">
        {row.label}
      </td>
      {row.monthly.map((v, m) => (
        <td key={m} className={`text-right py-1.5 px-2 ${montoCaja(v, !!positivo)}`}>
          {v === 0 ? "$0" : formatCLP(v)}
        </td>
      ))}
      <td className={`text-right py-1.5 pl-3 font-medium ${montoCaja(row.total, !!positivo)}`}>
        {row.total === 0 ? "$0" : formatCLP(row.total)}
      </td>
    </tr>
  );
}

function FilaTotalCaja({
  label,
  monthly,
  total,
  positivo,
  signo,
  bold,
  borderTop,
}: {
  label: string;
  monthly: number[];
  total: number;
  positivo?: boolean;
  signo?: boolean; // colorea por signo del valor (verde +, rojo −)
  bold?: boolean;
  borderTop?: boolean;
}) {
  const color = (v: number) =>
    signo ? montoCaja(v, v >= 0) : v === 0 ? "text-gray-300" : positivo ? "text-green-700" : "text-red-600";
  const base = `py-1.5 ${bold ? "font-bold" : "font-medium"} ${borderTop ? "border-t-2 border-gray-300" : "border-t border-gray-200"}`;
  return (
    <tr>
      <td className={`text-left text-gray-900 pr-3 sticky left-0 bg-white whitespace-nowrap ${base}`}>
        {label}
      </td>
      {monthly.map((v, m) => (
        <td key={m} className={`text-right px-2 ${base} ${color(v)}`}>
          {v === 0 ? "$0" : formatCLP(v)}
        </td>
      ))}
      <td className={`text-right pl-3 ${base} ${color(total)}`}>
        {total === 0 ? "$0" : formatCLP(total)}
      </td>
    </tr>
  );
}
