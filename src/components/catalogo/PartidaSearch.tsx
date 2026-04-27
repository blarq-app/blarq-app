"use client";

import { Fragment, useState, useEffect, useMemo } from "react";
import { formatCLP } from "@/lib/utils";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Component {
  id: string;
  type: string;
  description: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  referenceLink: string | null;
  _deleted?: boolean;
  _new?: boolean;
}

interface Partida {
  id: string;
  category: string;
  name: string;
  descriptionCliente: string | null;
  descriptionMaestro: string | null;
  sortOrder: number;
  unit: string;
  unitPrice: number;
  costMaterial: number;
  costLabor: number;
  costTools: number;
  costMargin: number;
  costLoss: number;
  costSubcontract: number;
  components: Component[];
}

const COMP_TYPES = [
  { value: "material", label: "Material" },
  { value: "mano_obra", label: "Mano de Obra" },
  { value: "herramientas", label: "Herramientas" },
  { value: "subcontrato", label: "Subcontrato" },
  { value: "perdida", label: "Pérdida" },
  { value: "margen", label: "Margen" },
];

const TYPE_COLORS: Record<string, string> = {
  material: "bg-blue-50 text-blue-700",
  mano_obra: "bg-green-50 text-green-700",
  margen: "bg-purple-50 text-purple-700",
  herramientas: "bg-yellow-50 text-yellow-800",
  subcontrato: "bg-orange-50 text-orange-700",
  perdida: "bg-red-50 text-red-700",
};

export default function PartidaSearch({ categories }: { categories: string[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [partidas, setPartidas] = useState<Partida[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partida | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(fetchPartidas, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, category]);

  async function fetchPartidas() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (category) params.set("category", category);
      params.set("limit", "300");
      const res = await fetch(`/api/catalogo/partidas?${params}`);
      const data = await res.json();
      setPartidas(Array.isArray(data) ? data : []);
    } catch {
      console.error("Error fetching");
    } finally {
      setLoading(false);
    }
  }

  function startEdit(partida: Partida) {
    setDraft(JSON.parse(JSON.stringify(partida)));
    setEditing(partida.id);
    setExpanded(partida.id);
  }

  function cancelEdit() {
    setEditing(null);
    setDraft(null);
  }

  function updateDraftComp(
    compId: string,
    field: keyof Component,
    value: string | number
  ) {
    if (!draft) return;
    setDraft({
      ...draft,
      components: draft.components.map((c) =>
        c.id === compId ? { ...c, [field]: value } : c
      ),
    });
  }

  function addComponent() {
    if (!draft) return;
    const tempId = `_new_${Date.now()}`;
    setDraft({
      ...draft,
      components: [
        ...draft.components,
        {
          id: tempId,
          type: "material",
          description: "",
          unit: "UN",
          quantity: 1,
          unitCost: 0,
          totalCost: 0,
          referenceLink: null,
          _new: true,
        },
      ],
    });
  }

  function removeComponent(compId: string) {
    if (!draft) return;
    const comp = draft.components.find((c) => c.id === compId);
    if (!comp) return;
    if (comp._new) {
      setDraft({
        ...draft,
        components: draft.components.filter((c) => c.id !== compId),
      });
    } else {
      setDraft({
        ...draft,
        components: draft.components.map((c) =>
          c.id === compId ? { ...c, _deleted: true } : c
        ),
      });
    }
  }

  function recalcCosts(components: Component[]) {
    const active = components.filter((c) => !c._deleted);
    const sum = (type: string) =>
      active
        .filter((c) => c.type === type)
        .reduce((s, c) => s + (c.quantity || 0) * (c.unitCost || 0), 0);
    const costMaterial = sum("material");
    const costLabor = sum("mano_obra");
    const costTools = sum("herramientas");
    const costSubcontract = sum("subcontrato");
    const costLoss = sum("perdida");
    const costMargin = sum("margen");
    const unitPrice =
      costMaterial + costLabor + costTools + costSubcontract + costLoss + costMargin;
    return { costMaterial, costLabor, costTools, costSubcontract, costLoss, costMargin, unitPrice };
  }

  async function saveEdit() {
    if (!draft) return;
    setSaving(true);
    try {
      const costs = recalcCosts(draft.components);
      await fetch(`/api/catalogo/partidas/${draft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          category: draft.category,
          unit: draft.unit,
          descriptionCliente: draft.descriptionCliente?.trim() || null,
          descriptionMaestro: draft.descriptionMaestro?.trim() || null,
          ...costs,
        }),
      });

      const toDelete = draft.components.filter((c) => c._deleted && !c._new);
      for (const c of toDelete) {
        await fetch(`/api/catalogo/partidas/${draft.id}/componentes/${c.id}`, {
          method: "DELETE",
        });
      }
      const toCreate = draft.components.filter((c) => c._new && !c._deleted);
      for (const c of toCreate) {
        await fetch(`/api/catalogo/partidas/${draft.id}/componentes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(c),
        });
      }
      const toUpdate = draft.components.filter((c) => !c._new && !c._deleted);
      for (const c of toUpdate) {
        await fetch(
          `/api/catalogo/partidas/${draft.id}/componentes/${c.id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(c),
          }
        );
      }

      await fetchPartidas();
      setEditing(null);
      setDraft(null);
      setSavedFlash(draft.id);
      setTimeout(() => setSavedFlash(null), 1500);
    } catch {
      alert("Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function deletePartida(id: string, name: string) {
    if (
      !confirm(
        `¿Eliminar definitivamente "${name}" del catálogo?\n\nSi está en uso en algún presupuesto el sistema lo va a bloquear.`
      )
    )
      return;
    const res = await fetch(`/api/catalogo/partidas/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Error al eliminar");
      return;
    }
    setPartidas((prev) => prev.filter((p) => p.id !== id));
    if (editing === id) cancelEdit();
  }

  async function duplicatePartida(id: string) {
    const res = await fetch(`/api/catalogo/partidas/${id}/duplicate`, {
      method: "POST",
    });
    if (!res.ok) {
      alert("Error al duplicar");
      return;
    }
    await fetchPartidas();
  }

  // ── Agrupar y ordenar por categoría con index 1, 2, 3...
  const grouped = useMemo(() => {
    const orderedCategories = categories
      .filter((cat) => !category || cat === category)
      .map((cat, idx) => ({
        category: cat,
        index: idx + 1,
        items: partidas
          .filter((p) => p.category === cat)
          .sort((a, b) => a.sortOrder - b.sortOrder),
      }))
      .filter((g) => g.items.length > 0);
    return orderedCategories;
  }, [categories, category, partidas]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  async function onDragEnd(e: DragEndEvent, group: { category: string; items: Partida[] }) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = group.items.findIndex((p) => p.id === active.id);
    const newIdx = group.items.findIndex((p) => p.id === over.id);
    const reordered = arrayMove(group.items, oldIdx, newIdx);

    // Optimistic UI: actualizar partidas localmente
    setPartidas((prev) => {
      const others = prev.filter((p) => p.category !== group.category);
      const newOrdered = reordered.map((p, i) => ({ ...p, sortOrder: i }));
      return [...others, ...newOrdered];
    });

    // Persistir en backend
    try {
      await fetch("/api/catalogo/partidas/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: reordered.map((p, i) => ({ id: p.id, sortOrder: i })),
        }),
      });
    } catch {
      alert("Error al guardar el orden");
      await fetchPartidas();
    }
  }

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <div className="flex gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar partida..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-1 focus:ring-gray-900 focus:border-transparent outline-none"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-1 focus:ring-gray-900 focus:border-transparent outline-none min-w-[200px]"
        >
          <option value="">Todas las categorías</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="text-gray-500 text-sm">Buscando…</p>}

      {/* Tabla principal */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {grouped.map((group) => (
          <div key={group.category}>
            {/* Chapter bar — matches PDF #DBDBDB */}
            <div className="flex items-center justify-between px-4 py-2 bg-[#DBDBDB]">
              <h3 className="font-bold text-gray-900 text-sm uppercase tracking-wide">
                <span className="inline-block w-6">{group.index}</span>
                {group.category}
              </h3>
              <span className="text-xs font-medium text-gray-700">
                {group.items.length} partida{group.items.length === 1 ? "" : "s"}
              </span>
            </div>

            {/* Column headers — matches PDF thead */}
            <div className="grid grid-cols-[3rem_minmax(0,2fr)_minmax(0,3fr)_3rem_6rem_2rem] items-center gap-3 px-4 py-2 border-y-2 border-gray-900 bg-white text-[11px] font-bold text-gray-900 uppercase tracking-wider">
              <div className="text-center">Nº</div>
              <div className="text-left">Partida</div>
              <div className="text-left">Descripción Cliente</div>
              <div className="text-center">Un.</div>
              <div className="text-right">P.U.</div>
              <div></div>
            </div>

            {/* Filas con drag & drop */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(e) => onDragEnd(e, group)}
            >
              <SortableContext
                items={group.items.map((p) => p.id)}
                strategy={verticalListSortingStrategy}
              >
                {group.items.map((partida, idx) => (
                  <PartidaRow
                    key={partida.id}
                    partida={partida}
                    chapterIndex={group.index}
                    rowIndex={idx + 1}
                    isExpanded={expanded === partida.id}
                    isEditing={editing === partida.id}
                    draft={editing === partida.id ? draft : null}
                    saving={saving}
                    savedFlash={savedFlash === partida.id}
                    onToggleExpand={() =>
                      setExpanded(
                        expanded === partida.id && editing !== partida.id ? null : partida.id
                      )
                    }
                    onStartEdit={() => startEdit(partida)}
                    onCancelEdit={cancelEdit}
                    onSaveEdit={saveEdit}
                    onUpdateDraft={(patch) =>
                      setDraft(draft ? { ...draft, ...patch } : null)
                    }
                    onUpdateDraftComp={updateDraftComp}
                    onAddComponent={addComponent}
                    onRemoveComponent={removeComponent}
                    onDuplicate={() => duplicatePartida(partida.id)}
                    onDelete={() => deletePartida(partida.id, partida.name)}
                    recalcCosts={recalcCosts}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        ))}

        {!loading && grouped.length === 0 && (
          <div className="p-8 text-center text-gray-500 text-sm">
            No se encontraron partidas
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// PartidaRow — fila individual con sortable, expand y edit inline
// ============================================================================
function PartidaRow({
  partida,
  chapterIndex,
  rowIndex,
  isExpanded,
  isEditing,
  draft,
  saving,
  savedFlash,
  onToggleExpand,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onUpdateDraft,
  onUpdateDraftComp,
  onAddComponent,
  onRemoveComponent,
  onDuplicate,
  onDelete,
  recalcCosts,
}: {
  partida: Partida;
  chapterIndex: number;
  rowIndex: number;
  isExpanded: boolean;
  isEditing: boolean;
  draft: Partida | null;
  saving: boolean;
  savedFlash: boolean;
  onToggleExpand: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onUpdateDraft: (patch: Partial<Partida>) => void;
  onUpdateDraftComp: (
    compId: string,
    field: keyof Component,
    value: string | number
  ) => void;
  onAddComponent: () => void;
  onRemoveComponent: (compId: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  recalcCosts: (components: Component[]) => {
    costMaterial: number;
    costLabor: number;
    costTools: number;
    costSubcontract: number;
    costLoss: number;
    costMargin: number;
    unitPrice: number;
  };
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: partida.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : "auto" as const,
    background: isDragging ? "#FAFAFA" : undefined,
  };

  const num = `${chapterIndex}.${rowIndex}`;
  const d = isEditing && draft ? draft : partida;

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={`grid grid-cols-[3rem_minmax(0,2fr)_minmax(0,3fr)_3rem_6rem_2rem] items-center gap-3 px-4 py-1.5 border-b border-gray-100 hover:bg-gray-50/60 group ${
          isExpanded ? "bg-gray-50/60" : ""
        } ${savedFlash ? "bg-green-50" : ""}`}
      >
        <div className="flex items-center gap-1 text-xs text-gray-700 tabular-nums">
          <span
            {...attributes}
            {...listeners}
            className="cursor-grab text-gray-300 hover:text-gray-700 px-0.5"
            title="Arrastrar para reordenar"
          >
            ⋮⋮
          </span>
          {num}
        </div>
        <button
          onClick={onToggleExpand}
          className="text-left text-xs text-gray-900 uppercase font-medium truncate"
          title={partida.name}
        >
          {partida.name}
        </button>
        <button
          onClick={onToggleExpand}
          className="text-left text-[11px] text-gray-500 truncate"
          title={partida.descriptionCliente || ""}
        >
          {partida.descriptionCliente || (
            <span className="text-gray-300">—</span>
          )}
        </button>
        <div className="text-center">
          <span className="text-[11px] text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
            {partida.unit}
          </span>
        </div>
        <div className="text-right text-xs font-medium text-gray-900 tabular-nums">
          {formatCLP(partida.unitPrice)}
        </div>
        <button
          onClick={onToggleExpand}
          className="text-gray-400 hover:text-gray-700 text-xs"
          title={isExpanded ? "Colapsar" : "Expandir"}
        >
          {isExpanded ? "▾" : "▸"}
        </button>
      </div>

      {/* Panel expandido */}
      {isExpanded && (
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-4">
          {isEditing ? (
            <EditPanel
              draft={draft!}
              saving={saving}
              onUpdateDraft={onUpdateDraft}
              onUpdateDraftComp={onUpdateDraftComp}
              onAddComponent={onAddComponent}
              onRemoveComponent={onRemoveComponent}
              onCancel={onCancelEdit}
              onSave={onSaveEdit}
              recalcCosts={recalcCosts}
            />
          ) : (
            <ViewPanel
              partida={d}
              onStartEdit={onStartEdit}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ViewPanel — vista solo lectura (descripciones + breakdown)
// ============================================================================
function ViewPanel({
  partida,
  onStartEdit,
  onDuplicate,
  onDelete,
}: {
  partida: Partida;
  onStartEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const breakdown = [
    { label: "Material", value: partida.costMaterial },
    { label: "Mano de obra", value: partida.costLabor },
    { label: "Herramientas", value: partida.costTools },
    { label: "Subcontrato", value: partida.costSubcontract },
    { label: "Pérdida", value: partida.costLoss },
    { label: "Margen", value: partida.costMargin },
  ].filter((b) => b.value > 0);

  return (
    <div className="space-y-4">
      {/* Descripciones */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
            Descripción para cliente
            <span className="ml-1 text-gray-400 normal-case font-normal italic">
              — aparece en el PDF que ve el cliente
            </span>
          </div>
          {partida.descriptionCliente ? (
            <p className="text-xs text-gray-700 leading-snug whitespace-pre-wrap">
              {partida.descriptionCliente}
            </p>
          ) : (
            <p className="text-xs text-gray-400 italic">Sin descripción</p>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
            Descripción para maestro
            <span className="ml-1 text-gray-400 normal-case font-normal italic">
              — aparece en el estado de pago
            </span>
          </div>
          {partida.descriptionMaestro ? (
            <p className="text-xs text-gray-700 leading-snug whitespace-pre-wrap">
              {partida.descriptionMaestro}
            </p>
          ) : (
            <p className="text-xs text-gray-400 italic">Sin descripción</p>
          )}
        </div>
      </div>

      {/* Breakdown */}
      {breakdown.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">
            Desglose de costos
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            {breakdown.map((b) => (
              <div key={b.label} className="text-xs">
                <span className="text-gray-500">{b.label}:</span>{" "}
                <span className="font-medium tabular-nums">{formatCLP(b.value)}</span>
              </div>
            ))}
          </div>
          {partida.components.length > 0 && (
            <table className="w-full text-[11px] mt-3">
              <thead>
                <tr className="border-y border-gray-300 text-gray-500 uppercase tracking-wider">
                  <th className="text-left py-1 px-2 font-semibold">Tipo</th>
                  <th className="text-left py-1 px-2 font-semibold">Descripción</th>
                  <th className="text-center py-1 px-2 font-semibold">Un.</th>
                  <th className="text-right py-1 px-2 font-semibold">Cant.</th>
                  <th className="text-right py-1 px-2 font-semibold">Costo</th>
                  <th className="text-right py-1 px-2 font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {partida.components.map((c) => (
                  <tr key={c.id} className="border-b border-gray-100">
                    <td className="py-1 px-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] ${
                          TYPE_COLORS[c.type] || "bg-gray-100"
                        }`}
                      >
                        {COMP_TYPES.find((t) => t.value === c.type)?.label || c.type}
                      </span>
                    </td>
                    <td className="py-1 px-2 text-gray-900">
                      {c.description}
                      {c.referenceLink && (
                        <a
                          href={c.referenceLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-1 text-blue-500"
                        >
                          ↗
                        </a>
                      )}
                    </td>
                    <td className="py-1 px-2 text-center text-gray-500">{c.unit}</td>
                    <td className="py-1 px-2 text-right text-gray-700 tabular-nums">
                      {c.quantity}
                    </td>
                    <td className="py-1 px-2 text-right text-gray-700 tabular-nums">
                      {formatCLP(c.unitCost)}
                    </td>
                    <td className="py-1 px-2 text-right font-medium text-gray-900 tabular-nums">
                      {formatCLP(c.totalCost)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-900">
                  <td colSpan={5} className="py-1.5 px-2 text-right uppercase text-[10px] font-bold tracking-wider text-gray-900">
                    Total
                  </td>
                  <td className="py-1.5 px-2 text-right font-bold text-gray-900 tabular-nums">
                    {formatCLP(partida.unitPrice)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Acciones */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-200">
        <button
          onClick={onDelete}
          className="text-xs text-red-500 hover:text-red-700"
        >
          Eliminar
        </button>
        <div className="flex gap-2">
          <button
            onClick={onDuplicate}
            className="text-xs text-gray-600 hover:text-gray-900 border border-gray-300 rounded px-3 py-1 hover:border-gray-500"
          >
            Duplicar
          </button>
          <button
            onClick={onStartEdit}
            className="text-xs text-white bg-gray-900 hover:bg-gray-700 rounded px-3 py-1"
          >
            Editar
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// EditPanel — modo edición con guardado explícito
// ============================================================================
function EditPanel({
  draft,
  saving,
  onUpdateDraft,
  onUpdateDraftComp,
  onAddComponent,
  onRemoveComponent,
  onCancel,
  onSave,
  recalcCosts,
}: {
  draft: Partida;
  saving: boolean;
  onUpdateDraft: (patch: Partial<Partida>) => void;
  onUpdateDraftComp: (
    compId: string,
    field: keyof Component,
    value: string | number
  ) => void;
  onAddComponent: () => void;
  onRemoveComponent: (compId: string) => void;
  onCancel: () => void;
  onSave: () => void;
  recalcCosts: (components: Component[]) => {
    costMaterial: number;
    costLabor: number;
    costTools: number;
    costSubcontract: number;
    costLoss: number;
    costMargin: number;
    unitPrice: number;
  };
}) {
  const costs = recalcCosts(draft.components);

  return (
    <div className="space-y-4">
      {/* Datos básicos */}
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-6">
          <label className="text-[10px] uppercase tracking-wider text-gray-500 block mb-1">
            Nombre
          </label>
          <input
            value={draft.name}
            onChange={(e) => onUpdateDraft({ name: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm uppercase focus:ring-1 focus:ring-gray-900 outline-none"
          />
        </div>
        <div className="col-span-3">
          <label className="text-[10px] uppercase tracking-wider text-gray-500 block mb-1">
            Categoría
          </label>
          <input
            value={draft.category}
            onChange={(e) => onUpdateDraft({ category: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-gray-900 outline-none"
          />
        </div>
        <div className="col-span-3">
          <label className="text-[10px] uppercase tracking-wider text-gray-500 block mb-1">
            Unidad
          </label>
          <select
            value={draft.unit}
            onChange={(e) => onUpdateDraft({ unit: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white focus:ring-1 focus:ring-gray-900 outline-none"
          >
            {["M2", "ML", "UN", "GL", "M3", "KG", "DIA", "HR"].map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Descripciones — dos columnas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-gray-500 block mb-1">
            Descripción para cliente
            <span className="ml-1 text-gray-400 normal-case font-normal italic">
              — aparece en el PDF que ve el cliente
            </span>
          </label>
          <textarea
            value={draft.descriptionCliente ?? ""}
            onChange={(e) => onUpdateDraft({ descriptionCliente: e.target.value })}
            placeholder="Ej: Considera retiro de papel mural, empastar, lijar y dejar superficie apta para pintura."
            rows={3}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs leading-snug resize-y focus:ring-1 focus:ring-gray-900 outline-none"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-gray-500 block mb-1">
            Descripción para maestro
            <span className="ml-1 text-gray-400 normal-case font-normal italic">
              — aparece en el estado de pago
            </span>
          </label>
          <textarea
            value={draft.descriptionMaestro ?? ""}
            onChange={(e) => onUpdateDraft({ descriptionMaestro: e.target.value })}
            placeholder="Ej: Retirar papel + empastar imperfecciones + lijar fino."
            rows={3}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs leading-snug resize-y focus:ring-1 focus:ring-gray-900 outline-none"
          />
        </div>
      </div>

      {/* Componentes */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wider text-gray-500">
            Desglose de costos
          </span>
          <button
            onClick={onAddComponent}
            className="text-xs text-gray-600 hover:text-gray-900 font-medium"
          >
            + Agregar componente
          </button>
        </div>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-y border-gray-300 text-gray-500 uppercase tracking-wider">
              <th className="text-left py-1 px-1 w-28 font-semibold">Tipo</th>
              <th className="text-left py-1 px-1 font-semibold">Descripción</th>
              <th className="text-center py-1 px-1 w-14 font-semibold">Un.</th>
              <th className="text-right py-1 px-1 w-20 font-semibold">Cant.</th>
              <th className="text-right py-1 px-1 w-24 font-semibold">Costo</th>
              <th className="text-right py-1 px-1 w-24 font-semibold">Total</th>
              <th className="w-6"></th>
            </tr>
          </thead>
          <tbody>
            {draft.components
              .filter((c) => !c._deleted)
              .map((comp) => (
                <tr key={comp.id} className="border-b border-gray-100">
                  <td className="py-1 px-1">
                    <select
                      value={comp.type}
                      onChange={(e) => onUpdateDraftComp(comp.id, "type", e.target.value)}
                      className="w-full border border-gray-300 rounded px-1 py-1 text-[11px] bg-white"
                    >
                      {COMP_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 px-1">
                    <input
                      value={comp.description}
                      onChange={(e) =>
                        onUpdateDraftComp(comp.id, "description", e.target.value)
                      }
                      className="w-full border border-gray-300 rounded px-2 py-1 text-[11px]"
                      placeholder="Descripción"
                    />
                  </td>
                  <td className="py-1 px-1">
                    <input
                      value={comp.unit}
                      onChange={(e) => onUpdateDraftComp(comp.id, "unit", e.target.value)}
                      className="w-full border border-gray-300 rounded px-1 py-1 text-[11px] text-center"
                    />
                  </td>
                  <td className="py-1 px-1">
                    <input
                      type="number"
                      step="0.001"
                      value={comp.quantity}
                      onChange={(e) =>
                        onUpdateDraftComp(comp.id, "quantity", parseFloat(e.target.value) || 0)
                      }
                      className="w-full border border-gray-300 rounded px-1 py-1 text-[11px] text-right tabular-nums"
                    />
                  </td>
                  <td className="py-1 px-1">
                    <input
                      type="number"
                      step="1"
                      value={comp.unitCost}
                      onChange={(e) =>
                        onUpdateDraftComp(comp.id, "unitCost", parseFloat(e.target.value) || 0)
                      }
                      className="w-full border border-gray-300 rounded px-1 py-1 text-[11px] text-right tabular-nums"
                    />
                  </td>
                  <td className="py-1 px-1 text-right font-medium text-gray-700 tabular-nums">
                    {formatCLP((comp.quantity || 0) * (comp.unitCost || 0))}
                  </td>
                  <td className="py-1 px-1 text-center">
                    <button
                      onClick={() => onRemoveComponent(comp.id)}
                      className="text-gray-300 hover:text-red-500"
                      title="Eliminar"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            <tr className="border-t-2 border-gray-900">
              <td colSpan={5} className="py-1.5 px-1 text-right uppercase text-[10px] font-bold tracking-wider text-gray-900">
                P.U. calculado
              </td>
              <td className="py-1.5 px-1 text-right font-bold text-gray-900 tabular-nums">
                {formatCLP(costs.unitPrice)}
              </td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Acciones */}
      <Fragment>
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-200">
          <button
            onClick={onCancel}
            className="text-sm px-4 py-1.5 border border-gray-300 rounded hover:bg-gray-100"
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="text-sm px-4 py-1.5 bg-gray-900 text-white rounded hover:bg-gray-700 disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </Fragment>
    </div>
  );
}
