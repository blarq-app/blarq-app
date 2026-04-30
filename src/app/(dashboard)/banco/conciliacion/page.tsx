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
  const movimientos = await prisma.bankMovement.findMany({
    where: { status: "sin_asignar" },
    orderBy: { date: "desc" },
    include: { bankAccount: { select: { alias: true } } },
  });

  // Pre-cargar facturas pendientes (toda la lista, después filtramos en JS)
  const pendingInvoices = await prisma.invoice.findMany({
    where: { status: "pendiente" },
    select: {
      id: true,
      type: true,
      folioNumber: true,
      businessName: true,
      totalAmount: true,
      issueDate: true,
      rutIssuer: true,
      rutReceiver: true,
    },
  });

  function candidatesFor(mov: { amount: number; counterpartyRut: string | null; type: string }) {
    const isCargo = mov.amount < 0;
    const targetType = isCargo ? "recibida" : "emitida";
    const abs = Math.abs(mov.amount);
    // Tomamos facturas del mismo tipo, con monto entre 30% y 200% del mov
    // (cubre pago total, parcial 50%, o un mov único que paga 2 facturas).
    const filtered = pendingInvoices.filter((inv) => {
      if (inv.type !== targetType) return false;
      const ratio = inv.totalAmount / abs;
      if (ratio < 0.3 || ratio > 3) return false;
      return true;
    });
    // Si tenemos counterpartyRut, priorizamos las que matchean por RUT
    let withMatch = filtered;
    if (mov.counterpartyRut) {
      const movDigits = mov.counterpartyRut.replace(/\D/g, "");
      const matched = filtered.filter((inv) => {
        const rut = (isCargo ? inv.rutIssuer : inv.rutReceiver) ?? "";
        const digits = rut.replace(/\D/g, "");
        return digits.length > 0 && (movDigits.includes(digits) || digits.includes(movDigits));
      });
      if (matched.length > 0) withMatch = matched;
    }
    // Top 8, ordenadas por proximidad de monto
    return withMatch
      .sort(
        (a, b) =>
          Math.abs(a.totalAmount - abs) - Math.abs(b.totalAmount - abs)
      )
      .slice(0, 8)
      .map((c) => ({ ...c, issueDate: c.issueDate.toISOString() }));
  }

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
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
          {movimientos.map((mov) => (
            <div key={mov.id}>
              {/* Encabezado del movimiento */}
              <div className="px-4 py-3 flex items-center gap-3">
                <span className="text-xs text-gray-500 w-20 tabular-nums whitespace-nowrap">
                  {new Date(mov.date).toLocaleDateString("es-CL", {
                    day: "2-digit",
                    month: "short",
                    year: "2-digit",
                  })}
                </span>
                <span className="text-xs text-gray-500 w-20 truncate">
                  {mov.bankAccount.alias}
                </span>
                <span className="text-sm text-gray-900 flex-1 truncate">
                  {mov.description}
                  {mov.counterpartyName && (
                    <span className="text-xs text-gray-400 ml-2">
                      ({mov.counterpartyName})
                    </span>
                  )}
                </span>
                <span
                  className={`text-sm tabular-nums font-medium whitespace-nowrap ${
                    mov.amount < 0 ? "text-red-700" : "text-green-700"
                  }`}
                >
                  {formatCLP(mov.amount)}
                </span>
              </div>
              {/* Form de asignación */}
              <AsignarMovimientoForm
                movimientoId={mov.id}
                amount={mov.amount}
                candidates={candidatesFor(mov)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
