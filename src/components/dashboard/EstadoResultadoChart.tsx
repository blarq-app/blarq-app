"use client";

import { useEffect, useRef, useState } from "react";
import { formatCLP } from "@/lib/utils";
import type {
  EstadoResultadoAnual,
  MonthBucket,
} from "@/lib/dashboard/estadoResultado";

const MESES = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];
const MESES_LARGO = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const CHART_H = 224; // alto del área de barras en px

export default function EstadoResultadoChart({
  initialData,
}: {
  initialData: EstadoResultadoAnual;
}) {
  const [data, setData] = useState(initialData);
  const [year, setYear] = useState(initialData.year);
  const [loading, setLoading] = useState(false);
  // Mes resaltado (0..11) o null = mostrar totales del año.
  const [sel, setSel] = useState<number | null>(null);

  // Ancho real del área de barras, para dibujar la línea SVG sin distorsión.
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartW, setChartW] = useState(0);
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setChartW(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  async function cambiarAnio(nuevo: number) {
    setYear(nuevo);
    setLoading(true);
    setSel(null);
    try {
      const res = await fetch(`/api/dashboard/estado-resultado?year=${nuevo}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  const { months } = data;

  // Escala de las barras (c/IVA): el máximo entre ingreso y egreso de todos
  // los meses define el 100% del alto.
  const maxBar = Math.max(
    1,
    ...months.map((m) => Math.max(m.ingreso, m.egreso))
  );

  // Último mes con actividad — la línea acumulada se dibuja solo hasta ahí
  // (no tiene sentido arrastrarla plana por meses futuros vacíos).
  let lastActive = -1;
  months.forEach((m, i) => {
    if (m.ingreso !== 0 || m.egreso !== 0) lastActive = i;
  });

  // Escala de la línea de utilidad acumulada (neto). Eje propio, independiente
  // de las barras (es otra métrica). El cero queda como referencia.
  const accVals = months
    .slice(0, Math.max(lastActive + 1, 1))
    .map((m) => m.utilidadAcumulada);
  const accMax = Math.max(0, ...accVals);
  const accMin = Math.min(0, ...accVals);
  const accRange = accMax - accMin || 1;
  const yOf = (v: number) => CHART_H - ((v - accMin) / accRange) * CHART_H;
  const xOf = (i: number) => ((i + 0.5) / 12) * chartW;
  const yZero = yOf(0);

  const detalle: MonthBucket | null = sel !== null ? months[sel] : null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 mb-6">
      {/* Header */}
      <div className="flex items-end justify-between px-5 pt-4 pb-3 border-b border-gray-100">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            Estado de Resultado Anual
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Ingresos vs egresos del estudio, mes a mes · montos con IVA
          </p>
        </div>
        <select
          value={year}
          onChange={(e) => cambiarAnio(Number(e.target.value))}
          className="text-sm border border-gray-300 rounded px-2 py-1 text-gray-900 tabular-nums focus:outline-none focus:border-gray-500"
        >
          {data.availableYears.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col lg:flex-row">
        {/* Gráfico */}
        <div
          className={`flex-1 px-5 py-4 transition-opacity ${loading ? "opacity-40" : ""}`}
          onMouseLeave={() => setSel(null)}
        >
          {/* Área de barras + línea */}
          <div
            ref={chartRef}
            className="relative"
            style={{ height: CHART_H }}
          >
            {/* Línea de cero de la acumulada (referencia tenue) */}
            {accMin < 0 && (
              <div
                className="absolute left-0 right-0 border-t border-dashed border-gray-200"
                style={{ top: yZero }}
              />
            )}

            {/* Barras por mes */}
            <div className="absolute inset-0 flex items-end">
              {months.map((m, i) => {
                const activo = sel === i;
                return (
                  <div
                    key={m.month}
                    className="flex-1 h-full flex items-end justify-center gap-[3px] cursor-default"
                    onMouseEnter={() => setSel(i)}
                  >
                    <Bar
                      valor={m.ingreso}
                      max={maxBar}
                      className={activo ? "bg-black" : "bg-gray-900"}
                    />
                    <Bar
                      valor={m.egreso}
                      max={maxBar}
                      className={activo ? "bg-gray-500" : "bg-gray-400"}
                    />
                  </div>
                );
              })}
            </div>

            {/* Línea de utilidad acumulada (neto), superpuesta */}
            {chartW > 0 && lastActive >= 0 && (
              <svg
                className="absolute inset-0 pointer-events-none"
                width={chartW}
                height={CHART_H}
              >
                {months.slice(0, lastActive + 1).map((m, i) => {
                  if (i === 0) return null;
                  const prev = months[i - 1];
                  const positivo = m.utilidadAcumulada >= 0;
                  return (
                    <line
                      key={i}
                      x1={xOf(i - 1)}
                      y1={yOf(prev.utilidadAcumulada)}
                      x2={xOf(i)}
                      y2={yOf(m.utilidadAcumulada)}
                      stroke={positivo ? "#16a34a" : "#dc2626"}
                      strokeWidth={2}
                    />
                  );
                })}
                {months.slice(0, lastActive + 1).map((m, i) => {
                  const positivo = m.utilidadAcumulada >= 0;
                  return (
                    <circle
                      key={i}
                      cx={xOf(i)}
                      cy={yOf(m.utilidadAcumulada)}
                      r={sel === i ? 4 : 3}
                      fill={positivo ? "#16a34a" : "#dc2626"}
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
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-900" />
              Ingresos
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-400" />
              Egresos
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-0.5 bg-green-600" />
              Utilidad acumulada (neto)
            </span>
          </div>
        </div>

        {/* Panel de desglose */}
        <DetallePanel
          year={year}
          mesIndex={sel}
          bucket={detalle}
          totales={data.totales}
        />
      </div>
    </div>
  );
}

function Bar({
  valor,
  max,
  className,
}: {
  valor: number;
  max: number;
  className: string;
}) {
  // El cero no ocupa espacio prominente: si es 0, no dibujamos barra.
  if (valor <= 0) return <div className="w-[42%]" />;
  // Mínimo 2px para que montos chicos sigan siendo visibles.
  const h = Math.max(2, (valor / max) * 100);
  return (
    <div
      className={`w-[42%] rounded-t-sm ${className}`}
      style={{ height: `${h}%` }}
    />
  );
}

function DetallePanel({
  year,
  mesIndex,
  bucket,
  totales,
}: {
  year: number;
  mesIndex: number | null;
  bucket: MonthBucket | null;
  totales: EstadoResultadoAnual["totales"];
}) {
  // Cuando no hay mes resaltado, mostramos los totales del año.
  const esAnio = bucket === null;
  const d = bucket ?? {
    ventas: totales.ventas,
    devoluciones: totales.devoluciones,
    otrosIngresos: totales.otrosIngresos,
    ingreso: totales.ingreso,
    proveedores: totales.proveedores,
    sueldos: totales.sueldos,
    otrosEgresos: totales.otrosEgresos,
    egreso: totales.egreso,
    utilidadNeta: totales.utilidadNeta,
    ivaPagar: totales.ivaPagar,
    utilidadAcumulada: totales.utilidadNeta,
  };

  const titulo =
    esAnio || mesIndex === null
      ? `Año ${year}`
      : `${MESES_LARGO[mesIndex]} ${year}`;

  return (
    <div className="lg:w-72 border-t lg:border-t-0 lg:border-l border-gray-100 px-5 py-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">{titulo}</h3>
        <span className="text-[10px] uppercase tracking-wider text-gray-400">
          {esAnio ? "Total año" : "Mes"}
        </span>
      </div>

      {/* Ingresos */}
      <Seccion titulo="Ingresos">
        <Fila label="Ventas" valor={d.ventas} />
        {d.otrosIngresos > 0 && (
          <Fila label="Otros ingresos" valor={d.otrosIngresos} />
        )}
        {d.devoluciones > 0 && (
          <Fila label="Devoluciones" valor={-d.devoluciones} muted />
        )}
        <FilaTotal label="Total ingresos" valor={d.ingreso} />
      </Seccion>

      {/* Egresos */}
      <Seccion titulo="Egresos">
        <Fila label="Proveedores" valor={d.proveedores} />
        {d.sueldos > 0 && <Fila label="Sueldos" valor={d.sueldos} />}
        {d.otrosEgresos > 0 && (
          <Fila label="Otros egresos" valor={d.otrosEgresos} />
        )}
        <FilaTotal label="Total egresos" valor={d.egreso} />
      </Seccion>

      {/* Resultado */}
      <div className="border-t border-gray-200 pt-3 mt-3 space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-gray-900">
            {esAnio ? "Utilidad del año" : "Utilidad del mes"}
            <span className="ml-1 text-[10px] font-normal text-gray-400">
              neto
            </span>
          </span>
          <span
            className={`text-sm font-bold tabular-nums ${
              d.utilidadNeta >= 0 ? "text-green-700" : "text-red-700"
            }`}
          >
            {formatCLP(d.utilidadNeta)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-gray-500">
            IVA a pagar
            <span className="ml-1 text-[10px] text-gray-400">
              ventas − compras
            </span>
          </span>
          <span className="text-xs font-medium tabular-nums text-gray-700">
            {formatCLP(d.ivaPagar)}
          </span>
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

function Seccion({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">
        {titulo}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Fila({
  label,
  valor,
  muted,
}: {
  label: string;
  valor: number;
  muted?: boolean;
}) {
  const cero = valor === 0;
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className={muted ? "text-gray-400" : "text-gray-600"}>{label}</span>
      <span
        className={`tabular-nums ${
          cero
            ? "text-gray-300"
            : muted
              ? "text-gray-400"
              : "text-gray-900"
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
      <span className="font-semibold tabular-nums text-gray-900">
        {formatCLP(valor)}
      </span>
    </div>
  );
}
