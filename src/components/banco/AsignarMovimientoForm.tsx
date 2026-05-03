"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatCLP } from "@/lib/utils";

type CandidateInvoice = {
  id: string;
  type: string;
  folioNumber: string | null;
  businessName: string | null;
  totalAmount: number;
  issueDate: string;
};

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

// Form de asignación de un movimiento bancario.
// Soporta:
//   - Vincular a factura completa o parcial (amountApplied custom)
//   - Splits: aplicar el mov a varias facturas con montos distintos
//   - Categorizar como sueldo/previred/etc cuando no hay factura
//   - Ignorar
export default function AsignarMovimientoForm({
  movimientoId,
  amount,
  candidates,
  existingPayments = [],
}: {
  movimientoId: string;
  amount: number;
  candidates: CandidateInvoice[];
  existingPayments?: ExistingPayment[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>("");
  const [montoInput, setMontoInput] = useState<string>("");

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
        setError(data.error ?? "Error");
        setBusy(false);
        return;
      }
      setSelectedInvoiceId("");
      setMontoInput("");
      router.refresh();
    } catch {
      setError("Error de red");
      setBusy(false);
    }
  }

  function addPayment() {
    if (!selectedInvoiceId) {
      setError("Elegí una factura");
      return;
    }
    const monto = Number(montoInput.replace(/\D/g, ""));
    if (!monto || monto <= 0) {
      setError("Ingresá un monto válido");
      return;
    }
    if (monto > remaining + 1) {
      setError(`El monto excede el saldo del movimiento (${formatCLP(remaining)} libres)`);
      return;
    }
    const newPayments = [
      ...existingPayments.map((p) => ({
        invoiceId: p.invoiceId,
        amountApplied: p.amountApplied,
      })),
      { invoiceId: selectedInvoiceId, amountApplied: monto },
    ];
    patch({ payments: newPayments });
  }

  function removePayment(paymentId: string) {
    const newPayments = existingPayments
      .filter((p) => p.id !== paymentId)
      .map((p) => ({ invoiceId: p.invoiceId, amountApplied: p.amountApplied }));
    patch({ payments: newPayments });
  }

  // Default smart del input cuando se elige una factura: el menor entre
  // (monto restante del mov) y (totalAmount de la factura).
  function onInvoiceChange(invoiceId: string) {
    setSelectedInvoiceId(invoiceId);
    if (!invoiceId) {
      setMontoInput("");
      return;
    }
    const inv = candidates.find((c) => c.id === invoiceId);
    if (!inv) return;
    const suggested = Math.min(remaining, inv.totalAmount);
    setMontoInput(String(Math.round(suggested)));
  }

  return (
    <div className="bg-gray-50 border-t border-gray-200 px-4 py-3 space-y-2">
      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          ⚠ {error}
        </div>
      )}

      {/* Imputaciones existentes (si las hay) */}
      {existingPayments.length > 0 && (
        <div className="space-y-1">
          {existingPayments.map((p) => (
            <div key={p.id} className="flex items-center gap-2 text-xs bg-white border border-gray-200 rounded px-2 py-1">
              <span className="text-gray-400">✓</span>
              <span className="text-gray-700 flex-1 truncate">
                F-{p.invoice.folioNumber} · {p.invoice.businessName?.slice(0, 30) ?? "—"}
                <span className="text-gray-400 ml-1">
                  ({formatCLP(p.amountApplied)} de {formatCLP(p.invoice.totalAmount)})
                </span>
              </span>
              <button
                disabled={busy}
                onClick={() => removePayment(p.id)}
                className="text-gray-400 hover:text-red-600 transition-colors"
                title="Quitar imputación"
              >
                ✕
              </button>
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

      {/* Form para imputar más (solo si queda saldo libre) */}
      {remaining > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {candidates.length > 0 ? (
            <>
              <span className="text-[10px] uppercase tracking-wider text-gray-500">
                Imputar a factura:
              </span>
              <select
                disabled={busy}
                value={selectedInvoiceId}
                onChange={(e) => onInvoiceChange(e.target.value)}
                className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
              >
                <option value="">— Elegir —</option>
                {candidates
                  .filter((c) => !existingPayments.some((p) => p.invoiceId === c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.type === "emitida" ? "Emit." : "Recib."} F-{c.folioNumber} ·{" "}
                      {c.businessName?.slice(0, 25) ?? "—"} · {formatCLP(c.totalAmount)}
                    </option>
                  ))}
              </select>
              {selectedInvoiceId && (
                <>
                  <span className="text-[10px] uppercase tracking-wider text-gray-500">
                    Monto:
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    disabled={busy}
                    value={montoInput}
                    onChange={(e) => setMontoInput(e.target.value)}
                    className="text-xs border border-gray-300 rounded px-2 py-1 bg-white w-28 tabular-nums"
                    placeholder="0"
                  />
                  <button
                    disabled={busy || !montoInput}
                    onClick={addPayment}
                    className="text-xs bg-gray-900 text-white px-3 py-1 rounded hover:bg-gray-800 disabled:opacity-50 transition-colors"
                  >
                    Vincular
                  </button>
                </>
              )}
            </>
          ) : (
            <span className="text-xs text-gray-400">Sin facturas candidatas para imputar.</span>
          )}

          {/* Acciones alternativas: solo si todavía no se imputó nada */}
          {existingPayments.length === 0 && (
            <>
              <span className="text-[10px] uppercase tracking-wider text-gray-500 ml-2">
                o:
              </span>
              <select
                disabled={busy}
                onChange={(e) => {
                  if (e.target.value) patch({ category: e.target.value });
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
                onClick={() => patch({ ignore: true })}
                className="text-xs text-gray-500 hover:text-gray-700 underline ml-auto"
              >
                Ignorar
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
