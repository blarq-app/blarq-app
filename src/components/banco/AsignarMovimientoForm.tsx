"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatCLP } from "@/lib/utils";
import MovementReconcileModal from "./MovementReconcileModal";

type ExistingPayment = {
  id: string;
  invoiceId: string;
  amountApplied: number;
  invoice: {
    folioNumber: string | null;
    businessName: string | null;
    totalAmount: number;
  };
};

const CATEGORIES = [
  { key: "sueldo", label: "Sueldo" },
  { key: "previred", label: "Previred" },
  { key: "comision_bancaria", label: "Comisión banco" },
  { key: "retiro_personal", label: "Retiro personal" },
  { key: "deposito_efectivo", label: "Depósito efectivo" },
  { key: "compra_tarjeta", label: "Compra tarjeta" },
  { key: "otro_sin_factura", label: "Otro / sin factura" },
];

// Form de asignación inline en /banco/conciliacion. Acciones:
//   - "Asignar pagos" abre el modal con búsqueda potente (Maxxa-style).
//   - Categorizar como sueldo/previred/etc cuando no hay factura.
//   - Ignorar.
export default function AsignarMovimientoForm({
  movimientoId,
  amount,
  description,
  counterpartyName,
  counterpartyRut,
  date,
  bankAccountAlias,
  existingPayments = [],
}: {
  movimientoId: string;
  amount: number;
  description: string;
  counterpartyName: string | null;
  counterpartyRut: string | null;
  date: string;
  bankAccountAlias: string;
  existingPayments?: ExistingPayment[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const absAmount = Math.abs(amount);
  const sumExisting = existingPayments.reduce((s, p) => s + p.amountApplied, 0);
  const remaining = Math.max(0, absAmount - sumExisting);

  async function patch(body: object) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/banco/movimientos/${movimientoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data.error ?? "Error";
        setError(msg);
        setBusy(false);
        throw new Error(msg);
      }
      router.refresh();
    } catch (e) {
      if (!error) setError("Error de red");
      setBusy(false);
      throw e;
    }
  }

  async function savePayments(payments: { invoiceId: string; amountApplied: number }[]) {
    await patch({ payments });
    setBusy(false);
  }

  return (
    <div className="bg-gray-50 border-t border-gray-100 px-4 py-2.5">
      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mb-2">
          ⚠ {error}
        </div>
      )}

      {/* Imputaciones existentes (resumen, edición vía modal) */}
      {existingPayments.length > 0 && (
        <div className="mb-2 space-y-1">
          {existingPayments.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2 text-xs text-gray-700 bg-white border border-gray-200 rounded px-2 py-1"
            >
              <span className="text-gray-400">✓</span>
              <span className="flex-1 truncate">
                F-{p.invoice.folioNumber} · {p.invoice.businessName?.slice(0, 35) ?? "—"}
                <span className="text-gray-400 ml-1">
                  ({formatCLP(p.amountApplied)} de {formatCLP(p.invoice.totalAmount)})
                </span>
              </span>
            </div>
          ))}
          <p className="text-[10px] text-gray-500 px-1 tabular-nums">
            Imputado: {formatCLP(sumExisting)} de {formatCLP(absAmount)} ·{" "}
            <span className={remaining > 0 ? "text-amber-700 font-medium" : "text-gray-400"}>
              {remaining > 0 ? `Saldo libre ${formatCLP(remaining)}` : "Totalmente imputado ✓"}
            </span>
          </p>
        </div>
      )}

      {/* Acciones — solo si queda saldo libre */}
      {remaining > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            disabled={busy}
            onClick={() => setModalOpen(true)}
            className="text-xs bg-gray-900 text-white px-3 py-1 rounded hover:bg-gray-800 disabled:opacity-50"
          >
            {existingPayments.length > 0 ? "Editar imputaciones" : "Asignar pagos"}
          </button>

          {existingPayments.length === 0 && (
            <>
              <span className="text-[10px] uppercase tracking-wider text-gray-500">o:</span>
              <select
                disabled={busy}
                onChange={(e) => {
                  if (e.target.value) patch({ category: e.target.value }).catch(() => {});
                }}
                defaultValue=""
                className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
              >
                <option value="">— Categorizar —</option>
                {CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
              <button
                disabled={busy}
                onClick={() => patch({ ignore: true }).catch(() => {})}
                className="text-xs text-gray-500 hover:text-gray-700 underline ml-auto"
              >
                Ignorar
              </button>
            </>
          )}
        </div>
      )}

      <MovementReconcileModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        movement={{
          id: movimientoId,
          amount,
          description,
          counterpartyName,
          counterpartyRut,
          date,
          bankAccountAlias,
        }}
        existingPayments={existingPayments}
        onSave={savePayments}
      />
    </div>
  );
}
