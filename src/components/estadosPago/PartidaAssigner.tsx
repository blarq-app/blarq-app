"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { groupByChapter, type ChapterLike } from "@/lib/presupuesto/chapters";

export type AssignerItem = {
  id: string;
  itemNumber: string;
  chapterId: string | null;
  subChapter: string | null;
  name: string;
  unit: string;
  quantity: number;
  sortOrder: number;
  assignedToThis: boolean;
  otherMaestroName: string | null;
};

// Selector de partidas de un maestro. La fuente de verdad es ObraItem.maestroId;
// tildar una partida acá se la asigna a este maestro (y se la quita a otro).
// "Seleccionar todo / Ninguno" para repartir rápido: el maestro que tiene casi
// todo tilda todo y destilda las pocas que no van.
export default function PartidaAssigner({
  projectId,
  maestroId,
  chapters,
  items,
}: {
  projectId: string;
  maestroId: string;
  chapters: ChapterLike[];
  items: AssignerItem[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(items.filter((i) => i.assignedToThis).map((i) => i.id))
  );
  const [saving, setSaving] = useState(false);
  // Arranca colapsado si el maestro ya tiene partidas asignadas (el reparto ya
  // está hecho; no queremos tapar los EPs). Si no tiene ninguna, arranca
  // abierto para invitar a repartir.
  const initialAssigned = items.filter((i) => i.assignedToThis).length;
  const [collapsed, setCollapsed] = useState(initialAssigned > 0);

  const initial = useMemo(
    () => new Set(items.filter((i) => i.assignedToThis).map((i) => i.id)),
    [items]
  );
  const dirty = useMemo(() => {
    if (selected.size !== initial.size) return true;
    for (const id of selected) if (!initial.has(id)) return true;
    return false;
  }, [selected, initial]);

  // Solo mostramos las partidas DISPONIBLES para este maestro: las libres (sin
  // dueño) y las que ya son de él (para poder destildarlas). Las que ya están
  // asignadas a OTRO maestro se esconden — así el reparto de cada maestro no se
  // pisa con el de los demás y "Seleccionar todo" no se las roba.
  const disponibles = useMemo(
    () => items.filter((i) => i.assignedToThis || !i.otherMaestroName),
    [items]
  );
  const ocupadasPorOtros = items.length - disponibles.length;

  // Agrupar por capítulo, en el orden de la versión (helper compartido con el
  // editor y el PDF).
  const grouped = useMemo(
    () => groupByChapter(chapters, disponibles),
    [chapters, disponibles]
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAll() {
    // Solo las disponibles — nunca las que ya son de otro maestro.
    setSelected(new Set(disponibles.map((i) => i.id)));
  }
  function selectNone() {
    setSelected(new Set());
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/proyectos/${projectId}/maestros/${maestroId}/partidas`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ obraItemIds: [...selected] }),
        }
      );
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "Error al guardar las partidas");
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div
        className={`flex items-center justify-between px-4 py-3 bg-gray-50 ${
          collapsed ? "" : "border-b border-gray-200"
        }`}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-900">
            Reparto de partidas
          </span>
          <span className="text-xs text-gray-500 tabular-nums">
            {collapsed
              ? `${selected.size} asignada${selected.size !== 1 ? "s" : ""}`
              : `${selected.size} de ${disponibles.length} disponibles tildadas`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {collapsed ? (
            <button
              onClick={() => setCollapsed(false)}
              className="text-xs text-gray-600 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-100"
            >
              Editar reparto
            </button>
          ) : (
            <>
              <button
                onClick={selectAll}
                className="text-xs text-gray-600 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-100"
              >
                Seleccionar todo
              </button>
              <button
                onClick={selectNone}
                className="text-xs text-gray-600 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-100"
              >
                Ninguno
              </button>
              <button
                onClick={save}
                disabled={!dirty || saving}
                className="bg-gray-900 text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? "Guardando..." : dirty ? "Guardar cambios" : "Guardado"}
              </button>
              {initialAssigned > 0 && (
                <button
                  onClick={() => setCollapsed(true)}
                  className="text-xs text-gray-600 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-100"
                >
                  Contraer
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {collapsed ? null : items.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-gray-500">
          Esta obra no tiene partidas de presupuesto todavía.
        </div>
      ) : disponibles.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-gray-500">
          Todas las partidas de la obra ya están repartidas a otros maestros.
          {ocupadasPorOtros > 0 && (
            <span className="block mt-1 text-xs text-gray-400">
              ({ocupadasPorOtros} partida{ocupadasPorOtros !== 1 ? "s" : ""} asignada
              {ocupadasPorOtros !== 1 ? "s" : ""} a otros)
            </span>
          )}
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {grouped.map(({ chapter, items: arr }) => (
            <div key={chapter.id}>
              <div className="px-4 py-1.5 bg-gray-50/60 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                {chapter.name}
              </div>
              {arr.map((it) => {
                const isSel = selected.has(it.id);
                return (
                  <label
                    key={it.id}
                    className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggle(it.id)}
                      className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400"
                    />
                    <span className="w-12 text-xs text-gray-500 tabular-nums shrink-0">
                      {it.itemNumber}
                    </span>
                    <span className="flex-1 text-sm text-gray-800">
                      {it.name}
                    </span>
                    <span className="text-xs text-gray-500 tabular-nums shrink-0">
                      {it.quantity} {it.unit}
                    </span>
                  </label>
                );
              })}
            </div>
          ))}
          {ocupadasPorOtros > 0 && (
            <div className="px-4 py-2 bg-gray-50/60 text-xs text-gray-400">
              {ocupadasPorOtros} partida{ocupadasPorOtros !== 1 ? "s" : ""} más ya
              {ocupadasPorOtros !== 1 ? " están" : " está"} asignada
              {ocupadasPorOtros !== 1 ? "s" : ""} a otros maestros (no se muestran acá).
            </div>
          )}
        </div>
      )}
    </div>
  );
}
