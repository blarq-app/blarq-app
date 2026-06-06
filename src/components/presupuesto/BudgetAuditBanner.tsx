"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCLP } from "@/lib/utils";
import type { AuditChange, AuditChangeRef } from "@/lib/catalog/auditChanges";

/**
 * Panel "Actualizar" del editor de presupuesto.
 *
 * Aparece arriba del editor cuando la cotización en borrador tiene diferencias
 * con el catálogo (precios cambiados, materiales nuevos o eliminados). Regla MJ
 * (2026-06-06): nada entra solo. El panel LISTA cada cambio y MJ elige, cambio
 * por cambio, cuáles acepta. Solo se aplica lo marcado; lo demás queda intacto.
 *
 * Solo se muestra en status="borrador" (enviado/aprobado están congelados).
 */

function changeKey(c: AuditChange): string {
  return `${c.kind}:${c.obraItemId}:${c.id}`;
}

const KIND_LABEL: Record<AuditChange["kind"], string> = {
  update: "Precio",
  add: "Material nuevo",
  remove: "Material eliminado",
};

const KIND_STYLE: Record<AuditChange["kind"], string> = {
  update: "bg-amber-100 text-amber-900",
  add: "bg-gray-100 text-gray-700",
  remove: "bg-red-100 text-red-800",
};

export default function BudgetAuditBanner({
  budgetId,
  status,
  onSynced,
}: {
  budgetId: string;
  status: string;
  onSynced?: () => void;
}) {
  const [changes, setChanges] = useState<AuditChange[] | null>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  const fetchChanges = useCallback(async () => {
    if (status !== "borrador") {
      setChanges([]);
      return;
    }
    try {
      const r = await fetch(
        `/api/catalogo/auditoria-precios?budgetId=${budgetId}`,
        { cache: "no-store" }
      );
      if (!r.ok) return;
      const json = await r.json();
      const list: AuditChange[] = json.changes ?? [];
      setChanges(list);
      // Por defecto todo seleccionado: MJ destilda lo que NO quiere aplicar.
      setSelected(new Set(list.map(changeKey)));
    } catch {
      // silencio
    }
  }, [budgetId, status]);

  useEffect(() => {
    fetchChanges();
  }, [fetchChanges]);

  // Agrupar por partida para mostrar ordenado.
  const grupos = useMemo(() => {
    const m = new Map<string, { itemNumber: string; itemName: string; rows: AuditChange[] }>();
    for (const c of changes ?? []) {
      if (!m.has(c.obraItemId)) {
        m.set(c.obraItemId, { itemNumber: c.itemNumber, itemName: c.itemName, rows: [] });
      }
      m.get(c.obraItemId)!.rows.push(c);
    }
    return Array.from(m.values()).sort((a, b) =>
      a.itemNumber.localeCompare(b.itemNumber, "es", { numeric: true })
    );
  }, [changes]);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function setAll(value: boolean) {
    if (!changes) return;
    setSelected(value ? new Set(changes.map(changeKey)) : new Set());
  }

  async function aplicar() {
    if (!changes) return;
    const refs: AuditChangeRef[] = changes
      .filter((c) => selected.has(changeKey(c)))
      .map((c) => ({ kind: c.kind, id: c.id, obraItemId: c.obraItemId }));
    if (refs.length === 0) return;
    setApplying(true);
    try {
      const r = await fetch("/api/catalogo/auditoria-precios/aplicar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budgetVersionId: budgetId, changes: refs }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        alert(err.error || "Error al aplicar los cambios");
        return;
      }
      await fetchChanges();
      onSynced?.();
      setOpen(false);
    } finally {
      setApplying(false);
    }
  }

  if (!changes || changes.length === 0) return null;

  const total = changes.length;
  const selCount = selected.size;

  return (
    <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50">
      {/* Cabecera del banner — siempre visible */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="text-xs text-amber-900">
          <span className="font-medium">
            {total} diferencia{total === 1 ? "" : "s"} con el catálogo
          </span>{" "}
          — precios, materiales nuevos o eliminados.
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
        >
          {open ? "Ocultar" : "Revisar y elegir"}
        </button>
      </div>

      {/* Panel desplegable: lista cambio por cambio */}
      {open && (
        <div className="border-t border-amber-200 bg-white rounded-b-lg">
          <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-gray-500 border-b border-gray-100">
            <span>Marcá lo que querés aplicar. Lo que dejes sin marcar queda como está.</span>
            <span className="flex gap-2">
              <button type="button" onClick={() => setAll(true)} className="underline hover:text-gray-700">
                Marcar todo
              </button>
              <button type="button" onClick={() => setAll(false)} className="underline hover:text-gray-700">
                Desmarcar todo
              </button>
            </span>
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
            {grupos.map((g) => (
              <div key={g.itemNumber + g.itemName} className="px-3 py-1.5">
                <div className="text-[11px] font-medium text-gray-900 mb-1">
                  {g.itemNumber} {g.itemName}
                </div>
                <ul className="space-y-1">
                  {g.rows.map((c) => {
                    const key = changeKey(c);
                    return (
                      <li key={key} className="flex items-start gap-2 text-[11px]">
                        <input
                          type="checkbox"
                          checked={selected.has(key)}
                          onChange={() => toggle(key)}
                          className="mt-0.5 accent-amber-700"
                        />
                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${KIND_STYLE[c.kind]}`}>
                          {KIND_LABEL[c.kind]}
                        </span>
                        <span className="text-gray-700 flex-1">
                          {c.kind === "update" && (
                            <>
                              {c.newDescription}
                              {c.oldDescription !== c.newDescription && (
                                <span className="text-gray-400"> (antes “{c.oldDescription}”)</span>
                              )}{" "}
                              <span className="text-gray-400 line-through tabular-nums">
                                {formatCLP(c.oldUnitCost)}
                              </span>{" "}
                              <span className="text-gray-900 tabular-nums">→ {formatCLP(c.newUnitCost)}</span>
                            </>
                          )}
                          {c.kind === "add" && (
                            <>
                              {c.description}{" "}
                              <span className="text-gray-900 tabular-nums">{formatCLP(c.unitCost)}</span>
                              <span className="text-gray-400"> / {c.unit}</span>
                            </>
                          )}
                          {c.kind === "remove" && (
                            <span className="text-gray-700">
                              {c.description}{" "}
                              <span className="text-gray-400 tabular-nums">{formatCLP(c.unitCost)}</span>
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100">
            <span className="text-[11px] text-gray-500">
              {selCount} de {total} seleccionado{selCount === 1 ? "" : "s"}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={aplicar}
                disabled={applying || selCount === 0}
                className="rounded bg-amber-900 px-3 py-1 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
              >
                {applying ? "Aplicando…" : `Aplicar seleccionados (${selCount})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
