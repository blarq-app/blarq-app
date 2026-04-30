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

const CATEGORIES = [
  { key: "sueldo", label: "Sueldo" },
  { key: "previred", label: "Previred" },
  { key: "comision_bancaria", label: "Comisión banco" },
  { key: "retiro_personal", label: "Retiro personal" },
  { key: "deposito_efectivo", label: "Depósito efectivo" },
  { key: "compra_tarjeta", label: "Compra tarjeta" },
  { key: "otro_sin_factura", label: "Otro / sin factura" },
];

// Form inline para conciliar un movimiento sin asignar.
// 3 caminos de acción:
//   1. Vincular a factura existente (dropdown de candidatas).
//   2. Categorizar como egreso/ingreso sin factura (sueldo, previred, etc).
//   3. Ignorar (marca como "otro_sin_factura").
export default function AsignarMovimientoForm({
  movimientoId,
  amount,
  candidates,
}: {
  movimientoId: string;
  amount: number;
  candidates: CandidateInvoice[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      router.refresh();
    } catch {
      setError("Error de red");
      setBusy(false);
    }
  }

  return (
    <div className="bg-gray-50 border-t border-gray-200 px-4 py-3 space-y-2">
      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          ⚠ {error}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {/* Vincular a factura: dropdown */}
        {candidates.length > 0 && (
          <>
            <span className="text-[10px] uppercase tracking-wider text-gray-500">
              Vincular a factura:
            </span>
            <select
              disabled={busy}
              onChange={(e) => {
                if (e.target.value) patch({ invoiceId: e.target.value });
              }}
              defaultValue=""
              className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
            >
              <option value="">— Elegir factura —</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.type === "emitida" ? "Emit." : "Recib."} F-{c.folioNumber} ·{" "}
                  {c.businessName?.slice(0, 25) ?? "—"} · {formatCLP(c.totalAmount)}
                  {Math.abs(c.totalAmount - Math.abs(amount)) < 1
                    ? " ✓ exacto"
                    : c.totalAmount > Math.abs(amount)
                      ? " (parcial)"
                      : " (excede)"}
                </option>
              ))}
            </select>
          </>
        )}

        {/* Categorizar como sin factura */}
        <span className="text-[10px] uppercase tracking-wider text-gray-500">
          o categorizar:
        </span>
        <select
          disabled={busy}
          onChange={(e) => {
            if (e.target.value) patch({ category: e.target.value });
          }}
          defaultValue=""
          className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
        >
          <option value="">— Elegir categoría —</option>
          {CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>

        {/* Ignorar */}
        <button
          disabled={busy}
          onClick={() => patch({ ignore: true })}
          className="text-xs text-gray-500 hover:text-gray-700 underline ml-auto"
        >
          Ignorar
        </button>
      </div>
    </div>
  );
}
