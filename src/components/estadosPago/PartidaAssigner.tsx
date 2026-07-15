"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { OBRA_CHAPTERS, ObraChapter } from "@/lib/utils";

export type AssignerItem = {
  id: string;
  itemNumber: string;
  chapter: string;
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
  items,
}: {
  projectId: string;
  maestroId: string;
  items: AssignerItem[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(items.filter((i) => i.assignedToThis).map((i) => i.id))
  );
  const [saving, setSaving] = useState(false);

  const initial = useMemo(
    () => new Set(items.filter((i) => i.assignedToThis).map((i) => i.id)),
    [items]
  );
  const dirty = useMemo(() => {
    if (selected.size !== initial.size) return true;
    for (const id of selected) if (!initial.has(id)) return true;
    return false;
  }, [selected, initial]);

  // Agrupar por capítulo, en el orden canónico de OBRA_CHAPTERS.
  const grouped = useMemo(() => {
    const g = new Map<string, AssignerItem[]>();
    for (const it of items) {
      if (!g.has(it.chapter)) g.set(it.chapter, []);
      g.get(it.chapter)!.push(it);
    }
    for (const arr of g.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder);
    return [...g.entries()].sort((a, b) => {
      const ia = OBRA_CHAPTERS[a[0] as ObraChapter]?.index ?? 99;
      const ib = OBRA_CHAPTERS[b[0] as ObraChapter]?.index ?? 99;
      return ia - ib;
    });
  }, [items]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAll() {
    setSelected(new Set(items.map((i) => i.id)));
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

  const chapterLabel = (c: string) =>
    OBRA_CHAPTERS[c as ObraChapter]?.label ?? c;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-900">
            Sus partidas
          </span>
          <span className="text-xs text-gray-500 tabular-nums">
            {selected.size} de {items.length} tildadas
          </span>
        </div>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

      {items.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-gray-500">
          Esta obra no tiene partidas de presupuesto todavía.
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {grouped.map(([chapter, arr]) => (
            <div key={chapter}>
              <div className="px-4 py-1.5 bg-gray-50/60 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                {chapterLabel(chapter)}
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
                      {!isSel && it.otherMaestroName && (
                        <span className="ml-2 text-xs text-gray-400">
                          · de {it.otherMaestroName}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-gray-500 tabular-nums shrink-0">
                      {it.quantity} {it.unit}
                    </span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
