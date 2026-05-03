import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { formatCLP } from "@/lib/utils";
import AsignarMovimientoForm from "@/components/banco/AsignarMovimientoForm";

// Página de conciliación: lista de movimientos sin_asignar con UI para
// asignarlos a factura existente, categorizar como egreso/ingreso sin
// factura, o ignorar.
//
// Para cada movimiento se computa la lista de "facturas candidatas":
// facturas pendientes con monto cercano (±20% del monto del movimiento)
// que pueden ser pago total o parcial. Ordenadas por monto más cercano.

export default async function ConciliacionPage() {
  // Mostramos sin_asignar Y parcial — los parciales todavía tienen saldo
  // libre por imputar (típico cuando un abono cubre obra+muebles+artefactos
  // y MJ ya asignó uno pero le falta los otros).
  const movimientos = await prisma.bankMovement.findMany({
    where: { status: { in: ["sin_asignar", "parcial"] } },
    orderBy: { date: "desc" },
    include: {
      bankAccount: { select: { alias: true } },
      payments: {
        include: {
          invoice: {
            select: { folioNumber: true, businessName: true, totalAmount: true },
          },
        },
      },
    },
  });

  // El modal de asignación hace su propia búsqueda dinámica via
  // /api/facturas/search — no precargamos candidatos en este server component.

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <Link href="/banco" className="text-xs text-gray-500 hover:text-gray-700 underline">
            ← Volver a cuentas
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">Conciliación</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {movimientos.length} movimiento{movimientos.length !== 1 ? "s" : ""} sin asignar
          </p>
        </div>
      </div>

      {movimientos.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <p className="text-sm text-gray-500">
            ✓ Todos los movimientos están conciliados o categorizados.
          </p>
        </div>
      ) : (
        (() => {
          // Agrupamos por día (yyyy-mm-dd) preservando el orden desc.
          const groups = new Map<string, typeof movimientos>();
          for (const m of movimientos) {
            const key = m.date.toISOString().slice(0, 10);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(m);
          }
          const dateLabel = (d: Date) =>
            d.toLocaleDateString("es-CL", {
              day: "2-digit",
              month: "long",
              year: "numeric",
            });
          return (
            <div className="space-y-6">
              {Array.from(groups.entries()).map(([dateKey, movs]) => {
                const dayDate = new Date(dateKey + "T12:00:00");
                return (
                  <section key={dateKey}>
                    {/* Date header */}
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xs uppercase tracking-wider font-semibold text-gray-700">
                        {dateLabel(dayDate)}
                      </span>
                      <div className="flex-1 border-t border-gray-200" />
                      <span className="text-[10px] uppercase tracking-wider text-gray-400">
                        {movs.length} mov{movs.length !== 1 ? "s" : ""}
                      </span>
                    </div>

                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                      {movs.map((mov, idx) => {
                        const isCargo = mov.amount < 0;
                        return (
                          <div
                            key={mov.id}
                            className={`flex border-l-4 ${
                              isCargo ? "border-rose-300" : "border-emerald-300"
                            } ${idx > 0 ? "border-t border-t-gray-100" : ""}`}
                          >
                            <div className="flex-1 min-w-0">
                              {/* Línea principal: monto + descripción */}
                              <div className="px-4 pt-3 pb-2 flex items-baseline gap-4">
                                <span
                                  className={`text-base font-semibold tabular-nums whitespace-nowrap min-w-[110px] ${
                                    isCargo ? "text-rose-700" : "text-emerald-700"
                                  }`}
                                >
                                  {formatCLP(mov.amount)}
                                </span>
                                <span className="text-sm text-gray-900 flex-1 truncate">
                                  {mov.description}
                                  {mov.counterpartyName && (
                                    <span className="text-xs text-gray-400 ml-2">
                                      · {mov.counterpartyName}
                                    </span>
                                  )}
                                </span>
                                <span className="text-[11px] text-gray-400 whitespace-nowrap">
                                  {mov.bankAccount.alias}
                                </span>
                              </div>
                              {/* Form de asignación, indentado bajo el monto */}
                              <AsignarMovimientoForm
                                movimientoId={mov.id}
                                amount={mov.amount}
                                description={mov.description}
                                counterpartyName={mov.counterpartyName}
                                counterpartyRut={mov.counterpartyRut}
                                date={mov.date.toISOString()}
                                bankAccountAlias={mov.bankAccount.alias}
                                existingPayments={mov.payments.map((p) => ({
                                  id: p.id,
                                  invoiceId: p.invoiceId,
                                  amountApplied: p.amountApplied,
                                  invoice: p.invoice,
                                }))}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          );
        })()
      )}
    </div>
  );
}
