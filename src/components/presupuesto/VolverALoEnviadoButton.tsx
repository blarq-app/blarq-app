"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "Volver a lo enviado": deshace ediciones manuales sobre una versión
 * enviada y la deja EXACTAMENTE como la foto del envío. Aparece en versiones
 * de obra y de artefactos ya enviadas que tienen foto. Para el caso "me
 * equivoqué editando, mejor la dejo como se mandó". No la reconecta al catálogo.
 */
export default function VolverALoEnviadoButton({
  budgetId,
  version,
}: {
  budgetId: string;
  version: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function restaurar() {
    setLoading(true);
    try {
      const res = await fetch(`/api/presupuestos/${budgetId}/restaurar-enviado`, {
        method: "POST",
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "No se pudo restaurar");
      }
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error al restaurar");
    } finally {
      setLoading(false);
      setConfirm(false);
    }
  }

  if (confirm) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-sm text-gray-600">¿Volver {version} a lo enviado?</span>
        <button
          onClick={restaurar}
          disabled={loading}
          className="px-3 py-1.5 rounded text-sm font-medium bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-50"
        >
          {loading ? "Restaurando…" : "Confirmar"}
        </button>
        <button
          onClick={() => setConfirm(false)}
          disabled={loading}
          className="px-3 py-1.5 rounded text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
        >
          Cancelar
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirm(true)}
      title="Deja la versión exactamente como se envió al cliente (deshace ediciones manuales posteriores)"
      className="px-3 py-1.5 rounded text-sm font-medium bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"
    >
      Volver a lo enviado
    </button>
  );
}
