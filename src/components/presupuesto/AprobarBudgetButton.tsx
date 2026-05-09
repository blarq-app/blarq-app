"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  budgetId: string;
  currentStatus: string;
  version: string;
}

export default function AprobarBudgetButton({ budgetId, currentStatus, version }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function handleSetStatus(newStatus: string, errMsg: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/presupuestos/${budgetId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error(errMsg);
      router.refresh();
    } catch (e) {
      console.error(e);
      alert(errMsg);
    } finally {
      setLoading(false);
      setConfirm(false);
    }
  }

  // Versión aprobada: click → confirma → vuelve a borrador. Útil para
  // deshacer una aprobación o cambiar cuál versión es la aprobada
  // (aprobando otra automáticamente desaprueba ésta).
  if (currentStatus === "aprobado") {
    if (confirm) {
      return (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">¿Volver {version} a borrador?</span>
          <button
            onClick={() => handleSetStatus("borrador", "Error al cambiar status")}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? "Guardando…" : "Confirmar"}
          </button>
          <button
            onClick={() => setConfirm(false)}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
          >
            Cancelar
          </button>
        </div>
      );
    }
    return (
      <button
        onClick={() => setConfirm(true)}
        title="Click para volver a borrador"
        className="px-3 py-1.5 rounded-lg text-sm font-medium bg-green-100 text-green-700 border border-green-200 hover:bg-green-200 transition-colors"
      >
        ✓ Aprobado
      </button>
    );
  }

  if (currentStatus === "rechazado") return null;

  async function handleAprobar() {
    return handleSetStatus("aprobado", "Error al aprobar el presupuesto");
  }

  if (confirm) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600">¿Aprobar {version}?</span>
        <button
          onClick={handleAprobar}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Aprobando…" : "Confirmar"}
        </button>
        <button
          onClick={() => setConfirm(false)}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
        >
          Cancelar
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirm(true)}
      className="px-3 py-1.5 rounded-lg text-sm font-medium bg-green-50 text-green-700 border border-green-300 hover:bg-green-100 transition-colors"
    >
      Marcar como aprobada
    </button>
  );
}
