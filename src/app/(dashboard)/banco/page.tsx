import { prisma } from "@/lib/prisma";
import { formatCLP } from "@/lib/utils";
import ImportCartolaButton from "@/components/banco/ImportCartolaButton";
import Link from "next/link";

export default async function BancoPage() {
  const accounts = await prisma.bankAccount.findMany({
    orderBy: { role: "asc" },
    include: {
      _count: { select: { movements: true } },
    },
  });

  // Para cada cuenta: saldo actual = sum amounts de todos los movs.
  // (Aproximación: parte de 0. El saldo "real" sale de las cartolas.)
  const accountsWithBalance = await Promise.all(
    accounts.map(async (a) => {
      const r = await prisma.bankMovement.aggregate({
        _sum: { amount: true },
        where: { bankAccountId: a.id },
      });
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
        sumAmounts: r._sum.amount ?? 0,
        lastMovementDate: lastMov?.date ?? null,
        sinAsignar,
      };
    })
  );

  const totalSinAsignar = accountsWithBalance.reduce((s, a) => s + a.sinAsignar, 0);

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cuentas bancarias</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {accountsWithBalance.length} cuenta{accountsWithBalance.length !== 1 ? "s" : ""}
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {accountsWithBalance.map((a) => (
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

      {accountsWithBalance.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-500">
          <p className="text-sm">No hay cuentas bancarias registradas.</p>
        </div>
      )}
    </div>
  );
}
