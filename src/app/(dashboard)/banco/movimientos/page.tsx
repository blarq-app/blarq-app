import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { formatCLP } from "@/lib/utils";

type SearchParams = {
  accountId?: string;
  status?: string;
};

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  sin_asignar: { label: "Sin asignar", tone: "bg-amber-100 text-amber-800" },
  conciliado: { label: "Conciliado", tone: "bg-green-100 text-green-800" },
  sin_factura: { label: "Sin factura", tone: "bg-blue-100 text-blue-800" },
  interno: { label: "Interno", tone: "bg-gray-100 text-gray-600" },
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

  const [movements, accounts] = await Promise.all([
    prisma.bankMovement.findMany({
      where,
      orderBy: { date: "desc" },
      take: 500,
      include: {
        bankAccount: { select: { alias: true } },
        invoice: { select: { id: true, folioNumber: true, businessName: true } },
      },
    }),
    prisma.bankAccount.findMany({ orderBy: { role: "asc" } }),
  ]);

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <Link href="/banco" className="text-xs text-gray-500 hover:text-gray-700 underline">
            ← Volver a cuentas
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">Movimientos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {movements.length} movimiento{movements.length !== 1 ? "s" : ""} · últimos 500
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
            <FilterLink key={key} sp={sp} field="status" value={key} label={label} />
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
                <th className="text-left px-4 py-2 w-28">Cuenta</th>
                <th className="text-left px-4 py-2">Descripción</th>
                <th className="text-right px-4 py-2">Monto</th>
                <th className="text-left px-4 py-2 w-32">Categoría</th>
                <th className="text-left px-4 py-2 w-32">Factura</th>
                <th className="text-left px-4 py-2 w-28">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {movements.map((m) => (
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
                      <span className="text-xs text-gray-400 ml-2">({m.counterpartyName})</span>
                    )}
                  </td>
                  <td
                    className={`px-4 py-2 text-right tabular-nums font-medium whitespace-nowrap ${
                      m.amount < 0 ? "text-red-700" : "text-green-700"
                    }`}
                  >
                    {formatCLP(m.amount)}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600">
                    {m.category ? (CATEGORY_LABEL[m.category] ?? m.category) : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {m.invoice ? (
                      <Link
                        href={`/facturas/${m.invoice.id}`}
                        className="text-gray-700 hover:text-gray-900 underline"
                      >
                        F-{m.invoice.folioNumber}
                      </Link>
                    ) : (
                      <span className="text-gray-400">—</span>
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
                </tr>
              ))}
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
