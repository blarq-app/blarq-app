import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { formatCLP } from "@/lib/utils";
import MovementActionButton from "@/components/banco/MovementActionButton";

type SearchParams = {
  accountId?: string;
  status?: string;
};

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  sin_asignar: { label: "Sin asignar", tone: "bg-amber-100 text-amber-800" },
  parcial: { label: "Parcial", tone: "bg-blue-100 text-blue-800" },
  conciliado: { label: "Conciliado", tone: "bg-green-100 text-green-800" },
  sin_factura: { label: "Sin factura", tone: "bg-gray-100 text-gray-700" },
  interno: { label: "Interno", tone: "bg-gray-100 text-gray-500" },
};

const CATEGORY_LABEL: Record<string, string> = {
  sueldo: "Sueldo",
  previred: "Previred",
  comision_bancaria: "Comisión banco",
  retiro_personal: "Retiro personal",
  deposito_efectivo: "Depósito efectivo",
  compra_tarjeta: "Compra tarjeta",
  transfer_interno: "Transfer interno",
  otro_sin_factura: "Otro",
};

export default async function MovimientosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const where: Record<string, unknown> = {};
  if (sp.accountId) where.bankAccountId = sp.accountId;
  if (sp.status) where.status = sp.status;

  const [movements, accounts, statusCounts] = await Promise.all([
    prisma.bankMovement.findMany({
      where,
      orderBy: { date: "desc" },
      take: 500,
      include: {
        bankAccount: { select: { alias: true } },
        payments: {
          include: {
            invoice: {
              select: { id: true, folioNumber: true, businessName: true, totalAmount: true },
            },
          },
        },
      },
    }),
    prisma.bankAccount.findMany({ orderBy: { role: "asc" } }),
    // Counts por status para las stats. Respeta el filtro de cuenta si lo hay.
    prisma.bankMovement.groupBy({
      by: ["status"],
      where: sp.accountId ? { bankAccountId: sp.accountId } : {},
      _count: { _all: true },
    }),
  ]);

  const totalCount = statusCounts.reduce((s, x) => s + x._count._all, 0);
  const countByStatus: Record<string, number> = {};
  for (const c of statusCounts) countByStatus[c.status] = c._count._all;
  const sinAsignar = (countByStatus.sin_asignar ?? 0) + (countByStatus.parcial ?? 0);
  const conciliados = countByStatus.conciliado ?? 0;
  const pctConciliado = totalCount > 0 ? Math.round((conciliados / totalCount) * 100) : 0;

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <Link href="/banco" className="text-xs text-gray-500 hover:text-gray-700 underline">
            ← Volver a cuentas
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">Movimientos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {movements.length} mostrados de {totalCount} total{totalCount !== 1 ? "es" : ""}
          </p>
        </div>
      </div>

      {/* Stats arriba — patrón Maxxa */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">Total movimientos</p>
          <p className="text-xl font-semibold text-gray-900 tabular-nums mt-0.5">{totalCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">
            Conciliados
            {totalCount > 0 && (
              <span className="ml-1.5 text-gray-400 normal-case">
                {pctConciliado}%
              </span>
            )}
          </p>
          <p className="text-xl font-semibold text-emerald-700 tabular-nums mt-0.5">
            {conciliados}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">
            Sin asignar / parcial
          </p>
          <p
            className={`text-xl font-semibold tabular-nums mt-0.5 ${
              sinAsignar > 0 ? "text-amber-700" : "text-gray-400"
            }`}
          >
            {sinAsignar}
          </p>
        </div>
      </div>

      {/* Filtros: cuenta + status */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
          <FilterLink sp={sp} field="accountId" value={undefined} label="Todas las cuentas" />
          {accounts.map((a) => (
            <FilterLink
              key={a.id}
              sp={sp}
              field="accountId"
              value={a.id}
              label={a.alias}
            />
          ))}
        </div>
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
          <FilterLink sp={sp} field="status" value={undefined} label="Todos" />
          {Object.entries(STATUS_LABEL).map(([key, { label }]) => (
            <FilterLink
              key={key}
              sp={sp}
              field="status"
              value={key}
              label={`${label}${countByStatus[key] ? ` (${countByStatus[key]})` : ""}`}
            />
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {movements.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <p className="text-sm">No hay movimientos.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-gray-500 bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2 w-24">Fecha</th>
                <th className="text-left px-4 py-2 w-24">Cuenta</th>
                <th className="text-left px-4 py-2">Descripción</th>
                <th className="text-right px-4 py-2">Monto</th>
                <th className="text-left px-4 py-2 w-32">Imputación</th>
                <th className="text-left px-4 py-2 w-28">Estado</th>
                <th className="px-4 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {movements.map((m) => {
                const isCargo = m.amount < 0;
                const sumApplied = m.payments.reduce((s, p) => s + p.amountApplied, 0);
                const remaining = Math.max(0, Math.abs(m.amount) - sumApplied);
                return (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-xs text-gray-700 whitespace-nowrap tabular-nums">
                      {new Date(m.date).toLocaleDateString("es-CL", {
                        day: "2-digit",
                        month: "short",
                        year: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-700">
                      {m.bankAccount.alias}
                    </td>
                    <td className="px-4 py-2 text-gray-900 truncate max-w-[280px]">
                      {m.description}
                      {m.counterpartyName && (
                        <span className="text-xs text-gray-400 ml-2">· {m.counterpartyName}</span>
                      )}
                    </td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums font-medium whitespace-nowrap ${
                        isCargo ? "text-rose-700" : "text-emerald-700"
                      }`}
                    >
                      {formatCLP(m.amount)}
                      {m.status === "parcial" && (
                        <div className="text-[10px] text-gray-400 font-normal">
                          libre {formatCLP(remaining)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {m.payments.length > 0 ? (
                        <div className="space-y-0.5">
                          {m.payments.slice(0, 2).map((p) => (
                            <Link
                              key={p.id}
                              href={`/facturas/${p.invoice.id}`}
                              className="block text-gray-700 hover:text-gray-900 hover:underline truncate"
                            >
                              F-{p.invoice.folioNumber} ({formatCLP(p.amountApplied)})
                            </Link>
                          ))}
                          {m.payments.length > 2 && (
                            <span className="text-[10px] text-gray-400">
                              + {m.payments.length - 2} más
                            </span>
                          )}
                        </div>
                      ) : m.category ? (
                        <span className="text-gray-600">
                          {CATEGORY_LABEL[m.category] ?? m.category}
                        </span>
                      ) : m.status === "interno" ? (
                        <span className="text-gray-500">transfer interno</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                          STATUS_LABEL[m.status]?.tone ?? "bg-gray-100"
                        }`}
                      >
                        {STATUS_LABEL[m.status]?.label ?? m.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <MovementActionButton
                        movimientoId={m.id}
                        amount={m.amount}
                        description={m.description}
                        counterpartyName={m.counterpartyName}
                        counterpartyRut={m.counterpartyRut}
                        date={m.date.toISOString()}
                        bankAccountAlias={m.bankAccount.alias}
                        existingPayments={m.payments.map((p) => ({
                          id: p.id,
                          invoiceId: p.invoiceId,
                          amountApplied: p.amountApplied,
                          invoice: {
                            folioNumber: p.invoice.folioNumber,
                            businessName: p.invoice.businessName,
                            totalAmount: p.invoice.totalAmount,
                          },
                        }))}
                        status={m.status}
                        variant={
                          m.status === "sin_asignar" || m.status === "parcial"
                            ? "primary"
                            : "ghost"
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function FilterLink({
  sp,
  field,
  value,
  label,
}: {
  sp: SearchParams;
  field: keyof SearchParams;
  value: string | undefined;
  label: string;
}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k !== field && v) params.set(k, v as string);
  }
  if (value) params.set(field, value);
  const href = `/banco/movimientos${params.toString() ? "?" + params.toString() : ""}`;
  const isActive = sp[field] === value || (!sp[field] && !value);
  return (
    <Link
      href={href}
      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
        isActive ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
      }`}
    >
      {label}
    </Link>
  );
}
