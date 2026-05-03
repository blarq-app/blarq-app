"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Botón que dispara POST /api/banco/reglas/aplicar — corre todas las reglas
// existentes contra los movs en status="sin_asignar". Pensado para reaplicar
// reglas viejas a movs importados antes de existir la regla, o después de
// crear/editar una regla.
export default function ApplyRulesButton({ unassignedCount }: { unassignedCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/banco/reglas/aplicar", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setResult(`✗ ${data.error ?? "Error"}`);
        return;
      }
      setResult(
        data.categorized > 0
          ? `✓ ${data.categorized} de ${data.tried} categorizados`
          : `· ${data.tried} probados, ninguno matcheó`
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
        disabled={busy || unassignedCount === 0}
        className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
        title={
          unassignedCount === 0
            ? "No hay movimientos sin asignar"
            : `Aplica las reglas a ${unassignedCount} mov sin asignar`
        }
      >
        {busy
          ? "Aplicando…"
          : `Aplicar reglas a sin_asignar (${unassignedCount})`}
      </button>
    </div>
  );
}
