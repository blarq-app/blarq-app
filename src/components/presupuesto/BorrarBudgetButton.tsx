"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Botón "Borrar" para una versión de presupuesto. Confirmación inline
// (no modal) para mantener consistencia con AprobarBudgetButton. Solo
// se ofrece para borradores y rechazadas — el endpoint igualmente
// valida en el server (defensa en profundidad).

export default function BorrarBudgetButton({
  budgetId,
  currentStatus,
  version,
}: {
  budgetId: string;
  currentStatus: string;
  version: string;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  // No mostrar el botón para versiones aprobadas (la API lo rechaza igual,
  // pero la UI no lo ofrece para no confundir).
  if (currentStatus === "aprobado") return null;

  async function handleBorrar() {
    setLoading(true);
    try {
      const res = await fetch(`/api/presupuestos/${budgetId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Error al borrar");
      }
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al borrar";
      alert(msg);
      setLoading(false);
      setConfirm(false);
    }
  }

  if (confirm) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600">¿Borrar {version}?</span>
        <button
          onClick={handleBorrar}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Borrando…" : "Confirmar"}
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
      className="text-sm text-red-600 hover:text-red-800 px-3 py-1 rounded-lg hover:bg-red-50 transition-colors"
    >
      Borrar
    </button>
  );
}
