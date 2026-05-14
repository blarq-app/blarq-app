"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ComponentDiff {
  componentId: string;
  itemName: string;
  itemNumber: string;
  oldDescription: string;
  newDescription: string;
  oldUnitCost: number;
  newUnitCost: number;
}

interface BudgetGroup {
  budgetId: string;
  version: string;
  projectId: string;
  projectName: string;
  date: string;
  components: ComponentDiff[];
}

interface AuditResult {
  totalStaleComponents: number;
  budgetsAffected: number;
  groups: BudgetGroup[];
}

function fmtCLP(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CL");
}

export default function AuditoriaPreciosClient() {
  const [data, setData] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | "all" | null>(null);

  async function reload() {
    setLoading(true);
    const r = await fetch("/api/catalogo/auditoria-precios", { cache: "no-store" });
    const json = await r.json();
    setData(json);
    setLoading(false);
  }

  useEffect(() => {
    reload();
  }, []);

  async function syncBudget(budgetId: string) {
    setSyncing(budgetId);
    try {
      const r = await fetch("/api/catalogo/auditoria-precios/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budgetVersionId: budgetId }),
      });
      if (!r.ok) throw new Error("error");
      await reload();
    } catch {
      alert("Error al sincronizar");
    } finally {
      setSyncing(null);
    }
  }

  async function syncAll() {
    if (!confirm(`Vas a actualizar ${data?.totalStaleComponents ?? 0} componentes en ${data?.budgetsAffected ?? 0} presupuestos. ¿Seguir?`)) {
      return;
    }
    setSyncing("all");
    try {
      const r = await fetch("/api/catalogo/auditoria-precios/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error("error");
      await reload();
    } catch {
      alert("Error al sincronizar");
    } finally {
      setSyncing(null);
    }
  }

  if (loading) {
    return <div className="text-sm text-gray-500">Cargando…</div>;
  }

  if (!data || data.totalStaleComponents === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-center">
        <div className="text-3xl mb-2">·</div>
        <div className="text-sm font-medium text-gray-900">
          Todo al día
        </div>
        <div className="text-xs text-gray-500 mt-1">
          No hay presupuestos en borrador con precios desactualizados.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
        <div>
          <div className="text-sm font-medium text-amber-900">
            {data.totalStaleComponents} componente{data.totalStaleComponents === 1 ? "" : "s"} desactualizado{data.totalStaleComponents === 1 ? "" : "s"} en {data.budgetsAffected} presupuesto{data.budgetsAffected === 1 ? "" : "s"} borrador
          </div>
          <div className="text-xs text-amber-700/80 mt-0.5">
            Actualizá todo de una o uno por uno desde abajo.
          </div>
        </div>
        <button
          onClick={syncAll}
          disabled={syncing !== null}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-wait"
        >
          {syncing === "all" ? "Actualizando…" : "Actualizar todos"}
        </button>
      </div>

      {data.groups.map((g) => (
        <div
          key={g.budgetId}
          className="rounded-xl border border-gray-200 bg-white"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <div>
              <Link
                href={`/proyectos/${g.projectId}/presupuesto/${g.budgetId}`}
                className="text-sm font-medium text-gray-900 hover:underline"
              >
                {g.projectName} · {g.version}
              </Link>
              <div className="text-xs text-gray-500 mt-0.5">
                {new Date(g.date).toLocaleDateString("es-CL")} ·{" "}
                {g.components.length} componente{g.components.length === 1 ? "" : "s"}
              </div>
            </div>
            <button
              onClick={() => syncBudget(g.budgetId)}
              disabled={syncing !== null}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-wait"
            >
              {syncing === g.budgetId ? "Actualizando…" : "Actualizar este"}
            </button>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 uppercase tracking-wider text-[10px] border-b border-gray-200">
                <th className="text-left py-2 px-4 font-medium">Partida</th>
                <th className="text-left py-2 px-2 font-medium">Componente</th>
                <th className="text-right py-2 px-2 font-medium">Antes</th>
                <th className="text-right py-2 px-4 font-medium">Ahora</th>
              </tr>
            </thead>
            <tbody>
              {g.components.map((c) => {
                const priceChanged =
                  Math.abs(c.oldUnitCost - c.newUnitCost) > 0.01;
                const descChanged = c.oldDescription !== c.newDescription;
                return (
                  <tr
                    key={c.componentId}
                    className="border-b border-gray-50 last:border-0"
                  >
                    <td className="py-1.5 px-4 text-gray-700">
                      {c.itemNumber} {c.itemName}
                    </td>
                    <td className="py-1.5 px-2">
                      {descChanged ? (
                        <span>
                          <span className="text-gray-400 line-through">{c.oldDescription}</span>{" "}
                          → <span className="text-gray-900">{c.newDescription}</span>
                        </span>
                      ) : (
                        <span className="text-gray-700">{c.newDescription}</span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-gray-400">
                      {fmtCLP(c.oldUnitCost)}
                    </td>
                    <td
                      className={`py-1.5 px-4 text-right tabular-nums font-medium ${
                        priceChanged
                          ? c.newUnitCost > c.oldUnitCost
                            ? "text-red-700"
                            : "text-green-700"
                          : "text-gray-900"
                      }`}
                    >
                      {fmtCLP(c.newUnitCost)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
