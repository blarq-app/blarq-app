"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Atajo "↔ Interna" inline: marca un mov como transferencia BLARQ↔BLARQ
// sin abrir el modal. Solo se renderiza cuando la contraparte es BLARQ
// (077270733-9), validado server-side antes de mostrar el botón.
export default function MarkInternalButton({ movimientoId }: { movimientoId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/banco/movimientos/${movimientoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markInternal: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Error: ${data.error ?? "no se pudo marcar"}`);
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
      title="Marcar como transferencia interna BLARQ↔BLARQ"
    >
      {busy ? "…" : "↔ Interna"}
    </button>
  );
}
