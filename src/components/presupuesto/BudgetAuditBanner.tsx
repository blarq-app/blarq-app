"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Cartel que aparece arriba del editor de presupuesto cuando hay
 * componentes desactualizados respecto al catálogo de materiales actual.
 *
 * Solo se muestra si:
 *   - El presupuesto está en status="borrador" (no entregado).
 *   - Hay al menos un componente con materialId linkeado donde la
 *     description o unitCost difiere del MaterialCatalog actual.
 *   - El componente NO está marcado como isCustomized (esos los
 *     respetamos — MJ los editó a propósito).
 */
export default function BudgetAuditBanner({
  budgetId,
  status,
  onSynced,
}: {
  budgetId: string;
  status: string;
  onSynced?: () => void;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);

  const fetchCount = useCallback(async () => {
    if (status !== "borrador") {
      setCount(0);
      return;
    }
    try {
      const r = await fetch(
        `/api/catalogo/auditoria-precios?budgetId=${budgetId}`,
        { cache: "no-store" }
      );
      if (!r.ok) return;
      const json = await r.json();
      setCount(json.totalStaleComponents ?? 0);
    } catch {
      // silencio
    }
  }, [budgetId, status]);

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  async function syncNow() {
    setSyncing(true);
    try {
      await fetch("/api/catalogo/auditoria-precios/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budgetVersionId: budgetId }),
      });
      await fetchCount();
      onSynced?.();
    } finally {
      setSyncing(false);
    }
  }

  if (!count) return null;

  return (
    <div className="mb-3 flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
      <div className="text-xs text-amber-900">
        <span className="font-medium">
          {count} diferencia{count === 1 ? "" : "s"} con el catálogo
        </span>{" "}
        — precios, materiales nuevos o eliminados.
      </div>
      <button
        type="button"
        onClick={syncNow}
        disabled={syncing}
        className="rounded bg-amber-900 px-3 py-1 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
      >
        {syncing ? "Actualizando…" : "Actualizar"}
      </button>
    </div>
  );
}
