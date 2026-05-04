"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Hint ✨ "match exacto disponible". Cuando un mov pendiente tiene UNA sola
// factura abierta del mismo proveedor con saldo restante = |amount|, este
// botón concilia con un click — sin abrir modal.
//
// Llamada al PATCH /api/banco/movimientos/[id] con el atajo `invoiceId`,
// que internamente crea InvoicePayment y marca status="conciliado".
export default function MatchHintButton({
  movimientoId,
  invoiceId,
  folio,
}: {
  movimientoId: string;
  invoiceId: string;
  folio: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/banco/movimientos/${movimientoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Error: ${data.error ?? "no se pudo conciliar"}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className="text-[11px] bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap"
      title={`Conciliar con F-${folio} (match exacto detectado)`}
    >
      {busy ? "…" : `✨ F-${folio}`}
    </button>
  );
}
