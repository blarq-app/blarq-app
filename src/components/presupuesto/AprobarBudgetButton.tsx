"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  budgetId: string;
  currentStatus: string;
  version: string;
}

/**
 * Transiciones de status del presupuesto:
 *   borrador → enviado | aprobado
 *   enviado  → borrador | aprobado
 *   aprobado → borrador (deshacer)
 *
 * Cualquier status ≠ "borrador" congela el presupuesto para los sync
 * automáticos de materiales / partidas. "Marcar como enviada" es la
 * forma rápida de congelar precios sin aprobar todavía.
 */
export default function AprobarBudgetButton({ budgetId, currentStatus, version }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  // Qué acción está pidiendo confirmación: null | "enviar" | "aprobar" | "desaprobar" | "desenviar"
  const [confirm, setConfirm] = useState<
    null | "enviar" | "aprobar" | "desaprobar" | "desenviar"
  >(null);

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
      setConfirm(null);
    }
  }

  // ── APROBADA ──────────────────────────────────────────────────
  if (currentStatus === "aprobado") {
    if (confirm === "desaprobar") {
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
            onClick={() => setConfirm(null)}
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
        onClick={() => setConfirm("desaprobar")}
        title="Click para volver a borrador"
        className="px-3 py-1.5 rounded-lg text-sm font-medium bg-green-100 text-green-700 border border-green-200 hover:bg-green-200 transition-colors"
      >
        ✓ Aprobado
      </button>
    );
  }

  // ── ENVIADA ───────────────────────────────────────────────────
  if (currentStatus === "enviado") {
    if (confirm === "aprobar") {
      return (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">¿Aprobar {version}?</span>
          <button
            onClick={() => handleSetStatus("aprobado", "Error al aprobar")}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? "Guardando…" : "Confirmar"}
          </button>
          <button
            onClick={() => setConfirm(null)}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
          >
            Cancelar
          </button>
        </div>
      );
    }
    if (confirm === "desenviar") {
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
            onClick={() => setConfirm(null)}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
          >
            Cancelar
          </button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => setConfirm("desenviar")}
          title="Click para volver a borrador (precios dejan de estar congelados)"
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200 transition-colors"
        >
          ⤴ Enviada
        </button>
        <button
          onClick={() => setConfirm("aprobar")}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-green-50 text-green-700 border border-green-300 hover:bg-green-100 transition-colors"
        >
          Marcar como aprobada
        </button>
      </div>
    );
  }

  // ── RECHAZADA ─────────────────────────────────────────────────
  if (currentStatus === "rechazado") return null;

  // ── BORRADOR (default) ────────────────────────────────────────
  if (confirm === "enviar") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600">
          ¿Marcar {version} como enviada al cliente?
        </span>
        <button
          onClick={() => handleSetStatus("enviado", "Error al marcar como enviada")}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Guardando…" : "Confirmar"}
        </button>
        <button
          onClick={() => setConfirm(null)}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
        >
          Cancelar
        </button>
      </div>
    );
  }

  if (confirm === "aprobar") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600">¿Aprobar {version}?</span>
        <button
          onClick={() => handleSetStatus("aprobado", "Error al aprobar el presupuesto")}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Aprobando…" : "Confirmar"}
        </button>
        <button
          onClick={() => setConfirm(null)}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
        >
          Cancelar
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setConfirm("enviar")}
        title="Congela los precios — útil cuando ya enviaste el presupuesto al cliente"
        className="px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 transition-colors"
      >
        Marcar como enviada
      </button>
      <button
        onClick={() => setConfirm("aprobar")}
        className="px-3 py-1.5 rounded-lg text-sm font-medium bg-green-50 text-green-700 border border-green-300 hover:bg-green-100 transition-colors"
      >
        Marcar como aprobada
      </button>
    </div>
  );
}
