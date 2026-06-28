import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getLiquidacionesMes } from "@/lib/contabilidad/remuneraciones";
import { formatCLP } from "@/lib/utils";
import EmpleadosEditor from "./EmpleadosEditor";
import IndicadoresEditor from "./IndicadoresEditor";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export default async function RemuneracionesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const sp = await searchParams;

  // Empleados e indicadores cargados.
  const empleados = await prisma.empleado.findMany({ orderBy: { nombre: "asc" } });
  const indicadores = await prisma.indicadorMensual.findMany({
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  // Años a mostrar: los que tienen indicador + el año en curso.
  const ahora = new Date();
  const currentYear = ahora.getUTCFullYear();
  const yearSet = new Set<number>([currentYear, ...indicadores.map((i) => i.year)]);
  const years = [...yearSet].sort((a, b) => b - a);

  const year =
    sp.year && years.includes(Number(sp.year)) ? Number(sp.year) : years[0];

  // Mes por defecto: el último con indicador en ese año, o el mes en curso.
  const indicadoresAnio = indicadores.filter((i) => i.year === year);
  const mesDefault =
    sp.month && Number(sp.month) >= 1 && Number(sp.month) <= 12
      ? Number(sp.month)
      : indicadoresAnio[0]?.month ??
        (year === currentYear ? ahora.getUTCMonth() + 1 : 12);
  const month = mesDefault;

  const indicadorActual =
    indicadores.find((i) => i.year === year && i.month === month) ?? null;
  const liq = await getLiquidacionesMes(year, month);

  const mesesConIndicador = new Set(
    indicadoresAnio.map((i) => i.month)
  );

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Remuneraciones</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Sueldos del mes y liquidaciones calculadas. El impuesto único de las
          liquidaciones alimenta el código 048 del F29.
        </p>
      </div>

      {/* Selector de año */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs uppercase tracking-wider text-gray-400">Año</span>
        {years.map((y) => (
          <Link
            key={y}
            href={`/contabilidad/remuneraciones?year=${y}`}
            className={`px-2.5 py-1 rounded text-sm font-medium tabular-nums transition-colors ${
              y === year
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {y}
          </Link>
        ))}
      </div>

      {/* Selector de mes */}
      <div className="grid grid-cols-6 sm:grid-cols-12 gap-1 mb-6">
        {MESES.map((nombre, idx) => {
          const m = idx + 1;
          const tiene = mesesConIndicador.has(m);
          const activo = m === month;
          return (
            <Link
              key={m}
              href={`/contabilidad/remuneraciones?year=${year}&month=${m}`}
              className={`text-center py-1.5 rounded text-xs font-medium transition-colors ${
                activo
                  ? "bg-gray-900 text-white"
                  : tiene
                    ? "text-gray-700 hover:bg-gray-100"
                    : "text-gray-300 hover:bg-gray-50"
              }`}
              title={nombre}
            >
              {nombre.slice(0, 3)}
            </Link>
          );
        })}
      </div>

      {/* Indicadores del mes (UF/UTM automáticas + topes editables) */}
      <IndicadoresEditor
        year={year}
        month={month}
        mesNombre={MESES[month - 1]}
        indicador={indicadorActual}
      />

      {/* Liquidaciones calculadas del mes */}
      {liq ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mt-6">
          <div className="px-5 py-3 border-b border-gray-200 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-gray-900">
              Liquidaciones · {MESES[month - 1]} {year}
            </h2>
            <span className="text-xs text-gray-400">
              Calculadas con los datos de abajo
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  <th className="text-left font-medium px-5 py-2">Empleado</th>
                  <th className="text-right font-medium px-3 py-2">Imponible</th>
                  <th className="text-right font-medium px-3 py-2">AFP</th>
                  <th className="text-right font-medium px-3 py-2">Salud</th>
                  <th className="text-right font-medium px-3 py-2">Cesantía</th>
                  <th className="text-right font-medium px-3 py-2">Imp. único</th>
                  <th className="text-right font-medium px-5 py-2">Líquido</th>
                </tr>
              </thead>
              <tbody>
                {liq.liquidaciones.map((l) => (
                  <tr key={l.rut} className="border-b border-gray-50">
                    <td className="px-5 py-2.5">
                      <div className="font-medium text-gray-900">{l.nombre}</div>
                      <div className="text-xs text-gray-400 tabular-nums">{l.rut}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{formatCLP(l.totalImponible)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{formatCLP(l.totalAfp)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{formatCLP(l.totalSalud)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{formatCLP(l.cesantia)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-900 font-medium">{formatCLP(l.impuestoUnico)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-gray-900 font-semibold">{formatCLP(l.liquido)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 text-sm">
                  <td className="px-5 py-2.5 font-semibold text-gray-900" colSpan={5}>
                    Código 048 — impuesto único del mes
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold text-gray-900">
                    {formatCLP(
                      liq.liquidaciones.reduce((s, l) => s + l.impuestoUnico, 0)
                    )}
                  </td>
                  <td className="px-5 py-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : (
        <div className="mt-6 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-5 py-4">
          No hay indicadores cargados para {MESES[month - 1]} {year}. Traelos
          arriba para ver las liquidaciones del mes.
        </div>
      )}

      {/* Empleados (editable) */}
      <div className="mt-8">
        <EmpleadosEditor empleados={empleados} />
      </div>
    </div>
  );
}
