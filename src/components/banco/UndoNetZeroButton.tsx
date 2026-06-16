"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// "deshacer" inline para un movimiento marcado como devolución neto cero.
// Suelta TODO el grupo del lavado (un lavado es atómico): los movimientos
// vuelven a "pendiente".
export default function UndoNetZeroButton({ movimientoId }: { movimientoId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    if (
      !confirm(
        "¿Deshacer la devolución neto cero?\n\nLos movimientos del grupo vuelven a \"pendiente\"."
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/banco/movimientos/${movimientoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ undoNetZero: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Error: ${data.error ?? "no se pudo deshacer"}`);
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
      className="text-[11px] text-gray-500 hover:text-gray-900 underline whitespace-nowrap disabled:opacity-50"
      title="Deshacer la devolución neto cero (vuelven a pendiente)"
    >
      {busy ? "…" : "deshacer"}
    </button>
  );
}
