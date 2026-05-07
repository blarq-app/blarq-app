"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Botón que dispara POST /api/banco/auto-conciliar-pendientes — corre la
// lógica de auto-match retroactivamente sobre todos los movs sin
// imputaciones que están en status "sin_asignar" o "sin_factura". Útil
// para limpiar movs huérfanos que no calzaron al importar la cartola.
export default function AutoConciliarPendientesButton({
  pendientesCount,
}: {
  pendientesCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/banco/auto-conciliar-pendientes", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setResult(`✗ ${data.error ?? "Error"}`);
        return;
      }
      const matched = data.matched ?? 0;
      const tried = data.tried ?? 0;
      setResult(
        matched > 0
          ? `✓ ${matched} de ${tried} conciliados`
          : `· ${tried} probados, ninguno matcheó`
      );
      router.refresh();
    } catch {
      setResult("✗ Error de red");
    } finally {
      setBusy(false);
      setTimeout(() => setResult(null), 8000);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {result && (
        <span className="text-xs text-gray-600 whitespace-nowrap">{result}</span>
      )}
      <button
        onClick={handleClick}
        disabled={busy || pendientesCount === 0}
        className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
        title={
          pendientesCount === 0
            ? "No hay movimientos pendientes de conciliar"
            : `Busca facturas pendientes con saldo similar para los ${pendientesCount} mov pendientes`
        }
      >
        {busy
          ? "Conciliando…"
          : `Auto-conciliar pendientes (${pendientesCount})`}
      </button>
    </div>
  );
}
