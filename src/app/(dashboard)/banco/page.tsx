import { prisma } from "@/lib/prisma";
import { formatCLP } from "@/lib/utils";
import ImportCartolaButton from "@/components/banco/ImportCartolaButton";
import Link from "next/link";
import {
  computeFondoSueldos,
  PLANILLA_MENSUAL_CLP,
  PROJECT_FONDO_INCLUDE,
} from "@/lib/banco/fondoSueldos";

export default async function BancoPage() {
  const accounts = await prisma.bankAccount.findMany({
    orderBy: { role: "asc" },
    include: {
      _count: { select: { movements: true } },
    },
  });

  // Para cada cuenta: saldo conocido (oficial del banco al último import) +
  // último movimiento + sin asignar.
  const accountsView = await Promise.all(
    accounts.map(async (a) => {
      const lastMov = await prisma.bankMovement.findFirst({
        where: { bankAccountId: a.id },
        orderBy: { date: "desc" },
        select: { date: true },
      });
      const sinAsignar = await prisma.bankMovement.count({
        where: { bankAccountId: a.id, status: "sin_asignar" },
      });
      return {
        ...a,
        lastMovementDate: lastMov?.date ?? null,
        sinAsignar,
      };
    })
  );

  const totalSinAsignar = accountsView.reduce((s, a) => s + a.sinAsignar, 0);
  const ctaSueldos = accountsView.find((a) => a.role === "salary_fund");

  // Fondo generado teórico (suma de todos los proyectos no-internos).
  // Computamos sobre todos los proyectos en estado activo.
  const projects = await prisma.project.findMany({
    where: { isInternal: false, status: { in: ["cotizacion", "ejecucion"] } },
    include: PROJECT_FONDO_INCLUDE,
  });
  const fondosPorProyecto = projects.map((p) => ({
    project: { id: p.id, name: p.name, numeroProyecto: p.numeroProyecto },
    fondo: computeFondoSueldos(p),
  }));
  const totalFondoGenerado = fondosPorProyecto.reduce(
    (s, f) => s + f.fondo.fondoGenerado,
    0
  );

  const saldoSueldos = ctaSueldos?.lastKnownBalance ?? null;
  const driftAFavor =
    saldoSueldos !== null ? totalFondoGenerado - saldoSueldos : null;
  const alcanceMeses =
    saldoSueldos !== null ? saldoSueldos / PLANILLA_MENSUAL_CLP : null;

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cuentas bancarias</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {accountsView.length} cuenta{accountsView.length !== 1 ? "s" : ""}
            {totalSinAsignar > 0 &&
              ` · ${totalSinAsignar} movimiento${totalSinAsignar > 1 ? "s" : ""} pendiente${totalSinAsignar > 1 ? "s" : ""} de asignar`}
          </p>
        </div>
        <ImportCartolaButton />
      </div>

      {totalSinAsignar > 0 && (
        <Link
          href="/banco/conciliacion"
          className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 mb-4 hover:border-gray-400 transition-colors"
        >
          <span className="text-gray-500 text-base leading-none">⚐</span>
          <p className="text-sm text-gray-900 flex-1">
            <span className="font-semibold">{totalSinAsignar} movimientos sin asignar</span> —
            categorizalos o vinculalos a una factura.
          </p>
          <span className="text-xs text-gray-500 underline">Conciliar →</span>
        </Link>
      )}

      {/* Panel Fondo Sueldos — saldo cta sueldos vs fondo teórico generado */}
      {ctaSueldos && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
              Fondo Sueldos
              <span className="text-[10px] text-gray-400 normal-case ml-2">
                planilla aprox {formatCLP(PLANILLA_MENSUAL_CLP)}/mes
              </span>
            </h2>
            {alcanceMeses !== null && (
              <span className="text-xs text-gray-500">
                Alcance:{" "}
                <span className="font-medium text-gray-900 tabular-nums">
                  {alcanceMeses.toFixed(1)} meses
                </span>
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">
                Saldo cta sueldos
              </p>
              <p className="text-xl font-semibold text-gray-900 tabular-nums">
                {saldoSueldos !== null ? formatCLP(saldoSueldos) : "—"}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {ctaSueldos.lastKnownBalanceDate
                  ? `al ${new Date(ctaSueldos.lastKnownBalanceDate).toLocaleDateString("es-CL", { day: "2-digit", month: "short" })}`
                  : "importá una cartola para ver el saldo"}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">
                Generado por proyectos
              </p>
              <p className="text-xl font-semibold text-gray-900 tabular-nums">
                {formatCLP(totalFondoGenerado)}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                acumulado teórico (GG obra + util muebles)
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">
                Diferencia
              </p>
              {totalFondoGenerado === 0 ? (
                <>
                  <p className="text-xl font-semibold tabular-nums text-gray-300">—</p>
                  <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">
                    sin facturas emitidas pagadas todavía.{" "}
                    <Link href="/banco/conciliacion" className="underline hover:text-gray-600">
                      conciliá cobros →
                    </Link>
                  </p>
                </>
              ) : (
                <>
                  <p
                    className={`text-xl font-semibold tabular-nums ${
                      driftAFavor === null
                        ? "text-gray-400"
                        : driftAFavor > 0
                          ? "text-amber-700"
                          : "text-gray-900"
                    }`}
                  >
                    {driftAFavor === null
                      ? "—"
                      : driftAFavor > 0
                        ? `+${formatCLP(driftAFavor)}`
                        : formatCLP(driftAFavor)}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {driftAFavor === null
                      ? "necesita saldo"
                      : driftAFavor > 0
                        ? "falta transferir a sueldos"
                        : "transferido de más"}
                  </p>
                </>
              )}
            </div>
          </div>

          {fondosPorProyecto.length > 0 && (
            <details className="mt-5 border-t border-gray-100 pt-3 group">
              <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 select-none">
                Ver desglose por proyecto ({fondosPorProyecto.filter((f) => f.fondo.fondoGenerado > 0).length})
              </summary>
              <table className="w-full text-xs mt-3">
                <thead className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-100">
                  <tr>
                    <th className="text-left pb-2">Proyecto</th>
                    <th className="text-right pb-2">GG obra gen.</th>
                    <th className="text-right pb-2">Util muebles gen.</th>
                    <th className="text-right pb-2">Total generado</th>
                  </tr>
                </thead>
                <tbody>
                  {fondosPorProyecto
                    .filter((f) => f.fondo.fondoGenerado > 0)
                    .sort((a, b) => b.fondo.fondoGenerado - a.fondo.fondoGenerado)
                    .map(({ project, fondo }) => (
                      <tr key={project.id} className="border-b border-gray-50">
                        <td className="py-1.5">
                          <Link
                            href={`/proyectos/${project.id}/resumen`}
                            className="text-gray-900 hover:underline"
                          >
                            {project.numeroProyecto && (
                              <span className="text-gray-400 mr-1.5 tabular-nums">
                                {project.numeroProyecto}
                              </span>
                            )}
                            {project.name}
                          </Link>
                        </td>
                        <td className="text-right tabular-nums text-gray-700">
                          {fondo.fondoObraGenerado > 0 ? formatCLP(fondo.fondoObraGenerado) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="text-right tabular-nums text-gray-700">
                          {fondo.fondoMueblesGenerado > 0 ? formatCLP(fondo.fondoMueblesGenerado) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="text-right tabular-nums font-medium text-gray-900">
                          {formatCLP(fondo.fondoGenerado)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {accountsView.map((a) => (
          <div key={a.id} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500">
                  {a.role === "salary_fund" ? "Fondo Sueldos" : a.role === "operating" ? "Operativa" : "Otra"}
                </p>
                <h2 className="text-lg font-semibold text-gray-900">{a.alias}</h2>
                <p className="text-xs text-gray-500 tabular-nums">
                  {a.bank} · {a.accountNumber}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider text-gray-400">Saldo</p>
                <p className="text-lg font-semibold text-gray-900 tabular-nums">
                  {a.lastKnownBalance !== null ? formatCLP(a.lastKnownBalance) : <span className="text-gray-300">—</span>}
                </p>
                {a.lastKnownBalanceDate && (
                  <p className="text-[10px] text-gray-400 tabular-nums">
                    al {new Date(a.lastKnownBalanceDate).toLocaleDateString("es-CL", { day: "2-digit", month: "short" })}
                  </p>
                )}
              </div>
            </div>

            <div className="border-t border-gray-100 pt-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Movimientos cargados</span>
                <span className="text-sm font-medium text-gray-900 tabular-nums">
                  {a._count.movements}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Último movimiento</span>
                <span className="text-xs text-gray-700">
                  {a.lastMovementDate
                    ? new Date(a.lastMovementDate).toLocaleDateString("es-CL", {
                        day: "2-digit",
                        month: "short",
                        year: "2-digit",
                      })
                    : "—"}
                </span>
              </div>
              {a.sinAsignar > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Sin asignar</span>
                  <span className="text-xs text-amber-700 font-medium">{a.sinAsignar}</span>
                </div>
              )}
            </div>

            <div className="border-t border-gray-100 pt-3 mt-3 flex items-center justify-between">
              <Link
                href={`/banco/movimientos?accountId=${a.id}`}
                className="text-xs text-gray-700 hover:text-gray-900 underline"
              >
                Ver movimientos →
              </Link>
            </div>
          </div>
        ))}
      </div>

      {accountsView.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-500">
          <p className="text-sm">No hay cuentas bancarias registradas.</p>
        </div>
      )}
    </div>
  );
}
