"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeleteRuleButton({ ruleId }: { ruleId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (busy) return;
    if (!confirm("¿Eliminar esta regla? Movimientos futuros con descripción similar volverán a quedar sin asignar.")) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/banco/reglas/${ruleId}`, { method: "DELETE" });
      if (!res.ok) {
        alert("Error al eliminar");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={busy}
      className="text-xs text-gray-400 hover:text-rose-600 disabled:opacity-50"
      title="Eliminar regla"
    >
      Eliminar
    </button>
  );
}
