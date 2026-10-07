import { prisma } from "@/lib/prisma";
import { formatCLP } from "@/lib/utils";
import { cargarCartola } from "@/lib/contabilidad/cartolaConciliadaDatos";
import {
  MESES_PERIODO as MESES,
  leerPeriodo,
  nombrePeriodo,
  periodoParam,
  periodoPorDefecto,
} from "@/lib/contabilidad/periodo";
import SelectorPeriodo from "@/components/contabilidad/SelectorPeriodo";
import BotonDescarga from "@/components/contabilidad/BotonDescarga";

// Contabilidad → Cartola.
//
// La cartola del banco del mes, CONCILIADA, para mandarle al contador
// (pendiente 196). Él recibía la cartola cruda y solo podía conciliar los
// montos exactos; acá baja la misma cartola con lo que explica cada movimiento:
// las facturas que paga (y cuánto a cada una), o qué es cuando no tiene
// factura (sueldo de qué mes, reembolso, traspaso, impuestos…).
//
// La pantalla es solo para elegir el mes (o el año completo) y bajar los
// archivos: el Excel (con el
// que trabaja el contador) y el PDF (para leer). Muestra además lo que conviene
// mirar ANTES de mandarla: los pendientes —que se van tal cual, marcados— y si
// los saldos cuadran con el banco. SOLO LEE.

type SearchParams = { periodo?: string };

function fecha(d: Date): string {
  return d.toLocaleDateString("es-CL", { timeZone: "UTC", day: "2-digit", month: "2-digit" });
}

export default async function CartolaPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const periodo = leerPeriodo(sp.periodo) ?? periodoPorDefecto();
  const { year, month } = periodo;

  const [cartola, fechas] = await Promise.all([
    cargarCartola(prisma, year, month),
    // Solo las fechas distintas, para el selector (qué años y meses tienen
    // movimientos; los vacíos van en gris, como en el F29 y Gastos).
    prisma.bankMovement.findMany({ select: { date: true }, distinct: ["date"] }),
  ]);

  const años = new Set(fechas.map((f) => f.date.getUTCFullYear()));
  años.add(year);
  const mesesConDatos = Array.from(
    new Set(fechas.filter((f) => f.date.getUTCFullYear() === year).map((f) => f.date.getUTCMonth() + 1))
  );

  const r = cartola.resumen;
  const pendientes = cartola.filas.filter((f) => f.estado !== "Conciliado");
  const vacio = r.movimientos === 0;
  const url = (formato: "xlsx" | "pdf") => `/api/contabilidad/cartola?periodo=${periodoParam(periodo)}&formato=${formato}`;

  return (
    <div>
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cartola conciliada</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            La cartola del banco con lo que explica cada movimiento — para el contador.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BotonDescarga href={url("xlsx")} deshabilitado={vacio} texto="Descargar Excel" />
          <BotonDescarga href={url("pdf")} deshabilitado={vacio} texto="Descargar PDF" />
        </div>
      </div>

      <SelectorPeriodo
        ruta="/contabilidad/cartola"
        periodo={periodo}
        años={[...años].sort((a, b) => b - a)}
        mesesConDatos={mesesConDatos}
      />

      {vacio ? (
        <div className="border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-500">
            No hay movimientos del banco en {month == null ? `el año ${year}` : nombrePeriodo(periodo)}.
          </p>
        </div>
      ) : (
        <div className="max-w-4xl space-y-6">
          <p className="text-sm text-gray-700">
            <span className="font-semibold tabular-nums">{r.movimientos}</span> movimientos ·{" "}
            <span className="tabular-nums">{r.conciliados}</span> conciliados ·{" "}
            <span className="tabular-nums">{r.parciales}</span> {r.parciales === 1 ? "parcial" : "parciales"} ·{" "}
            <span className={`tabular-nums ${r.pendientes ? "text-amber-800 font-medium" : ""}`}>
              {r.pendientes} {r.pendientes === 1 ? "pendiente" : "pendientes"}
            </span>
            {cartola.facturasPartidas.length > 0 && (
              <>
                {" "}· <span className="tabular-nums">{cartola.facturasPartidas.length}</span> facturas pagadas en partes
              </>
            )}
          </p>

          {pendientes.length > 0 && (
            <div>
              <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-1">
                Sin explicar del todo
              </h2>
              <p className="text-xs text-gray-500 mb-2">
                Van en la cartola marcados como pendientes. Si los conciliás antes de bajarla, salen explicados.
              </p>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500">
                      <th className="px-3 py-2 font-semibold">Fecha</th>
                      <th className="px-3 py-2 font-semibold">Cuenta</th>
                      <th className="px-3 py-2 font-semibold">Descripción en el banco</th>
                      <th className="px-3 py-2 font-semibold text-right">Monto</th>
                      <th className="px-3 py-2 font-semibold">Por qué</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pendientes.map((f) => (
                      <tr key={f.movimientoId} className="align-top">
                        <td className="px-3 py-1.5 tabular-nums text-gray-600 whitespace-nowrap">{fecha(f.fecha)}</td>
                        <td className="px-3 py-1.5 text-gray-600">{f.cuenta}</td>
                        <td className="px-3 py-1.5 text-gray-900 whitespace-nowrap">{f.descripcion}</td>
                        <td className="px-3 py-1.5 tabular-nums text-right whitespace-nowrap">
                          {f.cargo != null ? `−${formatCLP(f.cargo)}` : formatCLP(f.abono ?? 0)}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-gray-600">
                          {f.estado === "Parcial"
                            ? `Falta explicar ${formatCLP(f.sinExplicar)}`
                            : f.queEs === "Por aclarar"
                              ? f.detalle
                              : "Sin conciliar"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Cuadratura, chica: los saldos del banco contra la suma de los
              movimientos. Si no cuadra, falta o sobra algún movimiento. */}
          <div>
            <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-1">
              Cuadratura con el banco
            </h2>
            <ul className="text-xs text-gray-600 space-y-0.5">
              {cartola.cuadratura.map((q) => (
                <li key={q.cuenta} className="tabular-nums">
                  {q.cuenta} {q.numero}: {formatCLP(q.saldoInicial)} + {formatCLP(q.entradas)} −{" "}
                  {formatCLP(q.salidas)} = {formatCLP(q.saldoCalculado)} ·{" "}
                  {Math.abs(q.diferencia) > 0.5 ? (
                    <span className="text-amber-800 font-medium">
                      no cuadra: la cartola dice {formatCLP(q.saldoFinalBanco)} (diferencia {formatCLP(q.diferencia)})
                    </span>
                  ) : (
                    "cuadra con la cartola"
                  )}
                </li>
              ))}
              {cartola.cuadraturaPorMes
                .filter((q) => Math.abs(q.diferencia) > 0.5)
                .map((q) => (
                  <li key={`${q.month}-${q.cuenta}`} className="tabular-nums text-amber-800">
                    En {MESES[q.month - 1]}, {q.cuenta} no cuadra por {formatCLP(q.diferencia)}.
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
