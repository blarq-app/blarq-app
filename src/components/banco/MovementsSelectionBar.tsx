"use client";

import { formatCLP } from "@/lib/utils";
import MovementResolveMenu, { type MenuMovement } from "./MovementResolveMenu";

// Barra de selección para /banco/movimientos. Aparece fija abajo-centro
// cuando hay movimientos tildados. Reemplaza la vieja barra negra que tenía
// cinco botones distintos: ahora solo muestra el conteo + el MISMO menú
// "Resolver ▾" que la fila, aplicado a la selección. Un solo idioma para uno
// o varios movimientos.
export default function MovementsSelectionBar({
  movements,
  onClear,
  projects,
  categories,
  imputacionCategories,
  blarqRutDigits,
}: {
  movements: MenuMovement[];
  onClear: () => void;
  projects: { id: string; name: string; numeroProyecto: number | null }[];
  categories: { id: string; label: string }[];
  imputacionCategories: { value: string; label: string }[];
  blarqRutDigits: string;
}) {
  if (movements.length === 0) return null;

  const neto = movements.reduce((s, m) => s + m.amount, 0);

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-[calc(100vw-2rem)]">
      <div className="bg-gray-900 text-white rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium tabular-nums">
          {movements.length} seleccionado{movements.length !== 1 ? "s" : ""}
        </span>
        <span className="text-xs text-gray-400 tabular-nums">
          neto {formatCLP(neto)}
        </span>
        <span className="text-xs text-gray-500">·</span>

        <MovementResolveMenu
          movements={movements}
          mode="selection"
          projects={projects}
          categories={categories}
          imputacionCategories={imputacionCategories}
          blarqRutDigits={blarqRutDigits}
          onDone={onClear}
        />

        <button
          onClick={onClear}
          className="text-xs text-gray-300 hover:text-white px-2"
        >
          Limpiar
        </button>
      </div>
    </div>
  );
}
