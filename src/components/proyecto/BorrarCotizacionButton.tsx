"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Crucecita para eliminar una cotización desde la lista. Confirmación inline
// (mismo patrón que BorrarBudgetButton), sin modal. Solo se ofrece para
// cotizaciones activas/archivadas — el endpoint además valida en el server
// que no sea un proyecto ya convertido (defensa en profundidad).
//
// Eliminar es DESTRUCTIVO: se lleva presupuestos, estados de pago y lista de
// compra de la cotización. Por eso pide confirmar con el nombre a la vista.

export default function BorrarCotizacionButton({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleBorrar() {
    setLoading(true);
    try {
      const res = await fetch(`/api/proyectos/${projectId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Error al eliminar");
      }
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al eliminar";
      alert(msg);
      setLoading(false);
      setConfirm(false);
    }
  }

  if (confirm) {
    return (
      <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span className="text-xs text-gray-600">¿Eliminar?</span>
        <button
          onClick={handleBorrar}
          disabled={loading}
          className="px-2 py-1 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Eliminando…" : "Sí"}
        </button>
        <button
          onClick={() => setConfirm(false)}
          disabled={loading}
          className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
        >
          No
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirm(true)}
      title={`Eliminar cotización «${projectName}»`}
      aria-label={`Eliminar cotización ${projectName}`}
      className="text-gray-300 hover:text-red-600 hover:bg-red-50 w-6 h-6 rounded flex items-center justify-center text-sm leading-none transition-colors"
    >
      ✕
    </button>
  );
}
