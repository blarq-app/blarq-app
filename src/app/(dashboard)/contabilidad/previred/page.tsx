import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getPlanillaPreviredMes } from "@/lib/contabilidad/remuneraciones";
import { formatCLP } from "@/lib/utils";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export default async function PreviredPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const sp = await searchParams;

  const indicadores = await prisma.indicadorMensual.findMany({
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  const ahora = new Date();
  const currentYear = ahora.getUTCFullYear();
  const yearSet = new Set<number>([currentYear, ...indicadores.map((i) => i.year)]);
  const years = [...yearSet].sort((a, b) => b - a);
  const year =
    sp.year && years.includes(Number(sp.year)) ? Number(sp.year) : years[0];

  const indicadoresAnio = indicadores.filter((i) => i.year === year);
  const month =
    sp.month && Number(sp.month) >= 1 && Number(sp.month) <= 12
      ? Number(sp.month)
      : indicadoresAnio[0]?.month ??
        (year === currentYear ? ahora.getUTCMonth() + 1 : 12);

  const planilla = await getPlanillaPreviredMes(year, month);
  const mesesConIndicador = new Set(indicadoresAnio.map((i) => i.month));

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Previred</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Cotizaciones del mes por institución — lo que BLARQ paga a Previred,
          incluyendo los aportes del empleador.
        </p>
      </div>

      {/* Selector de año */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs uppercase tracking-wider text-gray-400">Año</span>
        {years.map((y) => (
          <Link
            key={y}
            href={`/contabilidad/previred?year=${y}`}
            className={`px-2.5 py-1 rounded text-sm font-medium tabular-nums transition-colors ${
              y === year ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
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
              href={`/contabilidad/previred?year=${year}&month=${m}`}
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

      {planilla ? (
        <>
          {/* Resumen por institución */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <Tarjeta etiqueta="AFP" valor={planilla.totalAFP} sub="AFP + SIS + cesantía" />
            <Tarjeta etiqueta="Isapre" valor={planilla.totalIsapre} sub="salud" />
            <Tarjeta etiqueta="Seguro Social" valor={planilla.totalSeguroSocial} sub="reforma 0,9%" />
            <Tarjeta etiqueta="Mutual" valor={planilla.totalMutual} sub={`${(planilla.tasaMutual * 100).toLocaleString("es-CL")}%`} />
          </div>

          {/* Total a pagar */}
          <div className="bg-gray-900 text-white rounded-xl px-5 py-4 flex items-baseline justify-between mb-6">
            <div>
              <p className="text-sm font-semibold">Total a pagar a Previred</p>
              <p className="text-xs text-gray-400">
                {MESES[month - 1]} {year} · remuneraciones del mes
              </p>
            </div>
            <p className="text-2xl font-bold tabular-nums">{formatCLP(planilla.totalGeneral)}</p>
          </div>

          {/* Detalle por trabajador */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-900">
                Detalle por trabajador
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                    <th className="text-left font-medium px-5 py-2">Trabajador</th>
                    <th className="text-right font-medium px-3 py-2">Imponible</th>
                    <th className="text-right font-medium px-3 py-2">AFP</th>
                    <th className="text-right font-medium px-3 py-2">Isapre</th>
                    <th className="text-right font-medium px-3 py-2">Seg. Social</th>
                    <th className="text-right font-medium px-5 py-2">Mutual</th>
                  </tr>
                </thead>
                <tbody>
                  {planilla.empleados.map((c) => (
                    <tr key={c.rut} className="border-b border-gray-50">
                      <td className="px-5 py-2.5">
                        <div className="font-medium text-gray-900">{c.nombre}</div>
                        <div className="text-xs text-gray-400 tabular-nums">{c.rut}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{formatCLP(c.imponible)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{formatCLP(c.totalAFP)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{formatCLP(c.totalIsapre)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{formatCLP(c.totalSeguroSocial)}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-gray-700">{formatCLP(c.totalMutual)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 text-sm font-semibold text-gray-900">
                    <td className="px-5 py-2.5">Total</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatCLP(planilla.empleados.reduce((s, c) => s + c.imponible, 0))}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatCLP(planilla.totalAFP)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatCLP(planilla.totalIsapre)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatCLP(planilla.totalSeguroSocial)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{formatCLP(planilla.totalMutual)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <p className="text-xs text-gray-400 mt-3 leading-relaxed">
            La columna AFP agrupa, como en Previred, el 10% + comisión del
            trabajador, el SIS (1,62%), el 0,1% del empleador y el seguro de
            cesantía (2,4% empleador + 0,6% trabajador). Tasa del Mutual de BLARQ:{" "}
            {(planilla.tasaMutual * 100).toLocaleString("es-CL")}% (constructora).
            Validado al peso contra la planilla pagada real de mayo 2026.
          </p>
        </>
      ) : (
        <div className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-5 py-4">
          No hay indicadores cargados para {MESES[month - 1]} {year}. Cargalos en
          la pestaña Remuneraciones para ver la planilla Previred.
        </div>
      )}
    </div>
  );
}

function Tarjeta({
  etiqueta,
  valor,
  sub,
}: {
  etiqueta: string;
  valor: number;
  sub: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-gray-400">{etiqueta}</p>
      <p className="text-lg font-bold text-gray-900 tabular-nums mt-0.5">{formatCLP(valor)}</p>
      <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>
    </div>
  );
}
