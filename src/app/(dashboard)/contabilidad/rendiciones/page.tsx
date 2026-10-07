import { prisma } from "@/lib/prisma";
import { formatCLP } from "@/lib/utils";
import { cargarRendiciones } from "@/lib/contabilidad/rendicionesDatos";
import { leerPeriodo, nombrePeriodo, periodoParam, periodoPorDefecto } from "@/lib/contabilidad/periodo";
import SelectorPeriodo from "@/components/contabilidad/SelectorPeriodo";
import BotonDescarga from "@/components/contabilidad/BotonDescarga";

// Contabilidad → Rendiciones.
//
// Las rendiciones de gastos de los socios, para el contador (la pidió él, MJ
// 2026-10-07): las compras de BLARQ que MJ o JT pagaron con su plata y que
// BLARQ les devolvió, cada reembolso con los documentos que lo respaldan. El
// detalle va en el Excel y el PDF; esta pantalla elige el período y muestra,
// por socio, cuánto se reembolsó y si a algo le falta respaldo. SOLO LEE.

type SearchParams = { periodo?: string };

function fecha(d: Date): string {
  return d.toLocaleDateString("es-CL", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
}

export default async function RendicionesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const periodo = leerPeriodo(sp.periodo) ?? periodoPorDefecto();
  const { year } = periodo;

  const [rendiciones, fechas] = await Promise.all([
    cargarRendiciones(prisma, periodo.year, periodo.month),
    prisma.bankMovement.findMany({ select: { date: true }, distinct: ["date"] }),
  ]);

  const años = new Set(fechas.map((f) => f.date.getUTCFullYear()));
  años.add(year);
  const mesesConDatos = Array.from(
    new Set(fechas.filter((f) => f.date.getUTCFullYear() === year).map((f) => f.date.getUTCMonth() + 1))
  );

  const vacio = rendiciones.socios.every((s) => s.reembolsos.length === 0);
  const url = (formato: "xlsx" | "pdf") =>
    `/api/contabilidad/rendiciones?periodo=${periodoParam(periodo)}&formato=${formato}`;

  return (
    <div>
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rendiciones</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Lo que cada socio pagó con su plata y BLARQ le reembolsó, con sus facturas — para el contador.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BotonDescarga href={url("xlsx")} deshabilitado={vacio} texto="Descargar Excel" />
          <BotonDescarga href={url("pdf")} deshabilitado={vacio} texto="Descargar PDF" />
        </div>
      </div>

      <SelectorPeriodo
        ruta="/contabilidad/rendiciones"
        periodo={periodo}
        años={[...años].sort((a, b) => b - a)}
        mesesConDatos={mesesConDatos}
      />

      {vacio ? (
        <div className="border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-500">No hay reembolsos a los socios en {nombrePeriodo(periodo)}.</p>
        </div>
      ) : (
        <div className="max-w-4xl space-y-6">
          {rendiciones.socios.map((s) => (
            <div key={s.socio}>
              <h2 className="text-sm font-semibold text-gray-900">{s.socio}</h2>
              {s.reembolsos.length === 0 ? (
                <p className="text-sm text-gray-400 mt-1">Sin reembolsos en {nombrePeriodo(periodo)}.</p>
              ) : (
                <>
                  <p className="text-sm text-gray-700 mt-1 tabular-nums">
                    {s.reembolsos.length} {s.reembolsos.length === 1 ? "reembolso" : "reembolsos"} ·{" "}
                    {s.documentos} documentos · reembolsado {formatCLP(s.total)} · con documentos{" "}
                    {formatCLP(s.respaldado)}
                    {s.sinRespaldo > 0 && (
                      <span className="text-amber-800 font-medium"> · sin respaldo {formatCLP(s.sinRespaldo)}</span>
                    )}
                  </p>
                  {/* Lo que conviene resolver antes de mandarla: los reembolsos
                      a los que les falta documento, con la nota que dejó MJ. */}
                  {s.reembolsos
                    .filter((r) => r.sinRespaldo > 0)
                    .map((r) => (
                      <div key={r.movimientoId} className="mt-2 text-xs text-gray-600 border-l border-amber-300 pl-3">
                        <p className="tabular-nums">
                          Reembolso del {fecha(r.fecha)} por {formatCLP(r.monto)}: faltan documentos por{" "}
                          <span className="text-amber-800 font-medium">{formatCLP(r.sinRespaldo)}</span>.
                        </p>
                        {r.nota && <p className="text-gray-500 whitespace-pre-line mt-0.5">{r.nota}</p>}
                      </div>
                    ))}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
