"use client";

import { Fragment, useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import MaterialAutocomplete from "./MaterialAutocomplete";
import RichTextEditor from "@/components/presupuesto/RichTextEditor";
import { sanitizeRichTextHtml, isRichTextEmpty } from "@/lib/richText";

// Unidades disponibles para una partida (las mismas que usa el editor inline).
const PARTIDA_UNITS = ["M2", "ML", "UN", "GL", "M3", "KG", "DIA", "HR"];

interface Component {
  id: string;
  type: string;
  description: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  referenceLink: string | null;
  materialId?: string | null;
  sortOrder?: number;
  // Para componentes con unit="%":
  //   - perdida + appliedToComponentId → % de un material concreto.
  //   - mano_obra + appliedToType="mano_obra" → leyes sociales (% de MO).
  appliedToComponentId?: string | null;
  appliedToType?: string | null;
  _deleted?: boolean;
  _new?: boolean;
}

// Calcula el total efectivo de un componente, aplicando la lógica de %
// (pérdida sobre material, leyes sobre MO, margen sobre todo el resto).
// Recursivo pero seguro: el caso base son componentes con unit ≠ "%".
function effectiveTotal(comp: Component, all: Component[]): number {
  const active = all.filter((c) => !c._deleted);
  const pct = comp.quantity || 0;

  if (comp.unit !== "%") {
    return (comp.quantity || 0) * (comp.unitCost || 0);
  }

  if (comp.type === "perdida") {
    // Pérdida % sobre UN material concreto.
    if (comp.appliedToComponentId) {
      const target = active.find((c) => c.id === comp.appliedToComponentId);
      if (!target) return 0;
      return effectiveTotal(target, all) * (pct / 100);
    }
    // Pérdida % sobre TODOS los materiales (Paso 4).
    if (comp.appliedToType === "material") {
      const matBase = active
        .filter((c) => c.type === "material" && c.id !== comp.id)
        .reduce((s, c) => s + effectiveTotal(c, all), 0);
      return matBase * (pct / 100);
    }
    // Pérdida % sin objetivo = $0.
    return 0;
  }

  if (comp.type === "mano_obra" && comp.appliedToType === "mano_obra") {
    // Leyes sociales: % sobre la suma de mano_obra (excluyéndose a sí misma
    // y a otras filas mano_obra con unit="%" para evitar circulares).
    const moBase = active
      .filter(
        (c) =>
          c.type === "mano_obra" && c.unit !== "%" && c.id !== comp.id
      )
      .reduce((s, c) => s + effectiveTotal(c, all), 0);
    return moBase * (pct / 100);
  }

  if (comp.type === "margen") {
    // Margen: % sobre todo el resto excepto pérdida y otros márgenes.
    const base = active
      .filter((c) => c.id !== comp.id && c.type !== "margen" && c.type !== "perdida")
      .reduce((s, c) => s + effectiveTotal(c, all), 0);
    return base * (pct / 100);
  }

  // Default fallback para unit=% sin contexto explícito (componente legacy
  // o configuración incompleta).
  return (comp.quantity || 0) * (comp.unitCost || 0);
}

// Orden visual: respeta sortOrder pero ancla los componentes tipo "margen"
// al final, sin importar dónde estén en sortOrder. (item 5a)
function sortForDisplay(comps: Component[]): Component[] {
  const regular = comps
    .filter((c) => c.type !== "margen")
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const margen = comps.filter((c) => c.type === "margen");
  return [...regular, ...margen];
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
  // Qué partida tiene la descripción para cliente abierta para editar INLINE
  // en la fila (igual que en las cotizaciones). null = ninguna.
  const [editingDescId, setEditingDescId] = useState<string | null>(null);

  // Catálogo de categorías como estado (no prop): al crear una partida con
  // una categoría nueva, la agregamos acá para que aparezca sin recargar.
  const [allCategories, setAllCategories] = useState<string[]>(categories);
  const [creating, setCreating] = useState(false);
  const [newForm, setNewForm] = useState({ name: "", category: "", unit: "GL" });

  // Foco desde el presupuesto: al apretar "Editar en catálogo" en el desglose
  // de una partida, se llega con ?focus=<catalogPartidaId>. Abrimos esa partida
  // directo en modo edición, hacemos scroll a su fila y la resaltamos un par de
  // segundos para ubicarla. (Mismo patrón que el catálogo de materiales.)
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus");
  const handledFocusRef = useRef<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(fetchPartidas, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, category]);

  useEffect(() => {
    if (!focusId || handledFocusRef.current === focusId || partidas.length === 0)
      return;
    const partida = partidas.find((p) => p.id === focusId);
    if (!partida) return;
    handledFocusRef.current = focusId;
    startEdit(partida);
    setHighlightId(partida.id);
  }, [focusId, partidas]);

  // Scroll + apagado del resaltado, una vez que la fila enfocada está montada.
  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(`partida-row-${highlightId}`);
    el?.scrollIntoView({ block: "center" });
    const t = setTimeout(() => setHighlightId(null), 2500);
    return () => clearTimeout(t);
  }, [highlightId]);

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

  // Reordena los componentes regulares (margen va al final, no entra acá).
  // Recibe los IDs en el orden nuevo y reasigna sortOrder consecutivo. (5d)
  function reorderComps(orderedIds: string[]) {
    if (!draft) return;
    const orderMap = new Map(orderedIds.map((id, i) => [id, i]));
    setDraft({
      ...draft,
      components: draft.components.map((c) => {
        const newOrder = orderMap.get(c.id);
        return newOrder !== undefined ? { ...c, sortOrder: newOrder } : c;
      }),
    });
  }

  // Al elegir un material del catálogo: autocompleta description, unit y
  // unitCost (= netPrice del material), y guarda materialId. (5b)
  function selectMaterial(
    compId: string,
    material: { id: string; name: string; unit: string; netPrice: number }
  ) {
    if (!draft) return;
    setDraft({
      ...draft,
      components: draft.components.map((c) =>
        c.id === compId
          ? {
              ...c,
              description: material.name,
              unit: material.unit,
              unitCost: material.netPrice,
              materialId: material.id,
            }
          : c
      ),
    });
  }

  // Al cambiar el TIPO de un componente, limpiar los campos appliedTo*
  // (eran válidos sólo bajo la combinación type/unit anterior).
  //
  // Pérdida y margen son recargos PORCENTUALES, no montos sueltos: al elegir
  // ese tipo, la línea pasa sola a "%" con su fórmula armada (pérdida = % sobre
  // todos los materiales; margen = % sobre el resto), así calcula de inmediato.
  // Antes quedaba en "UN" cant 1 → daba $0 y había que configurarla a mano
  // (cambiar unidad a % + elegir "todos los materiales"), que no es obvio.
  function changeCompType(compId: string, newType: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      components: draft.components.map((c) => {
        if (c.id !== compId) return c;
        const next = { ...c, type: newType };
        next.appliedToComponentId = null;
        next.appliedToType = null;
        if (newType === "perdida") {
          next.unit = "%";
          next.appliedToType = "material"; // sobre todos los materiales por defecto
          if (c.unit !== "%") next.quantity = 10;
        } else if (newType === "margen") {
          next.unit = "%";
          if (c.unit !== "%") next.quantity = 10;
        } else if (c.unit === "%") {
          // Volver a un tipo de costo directo desde un %: la unidad "%" ya no
          // aplica → default a "UN" para que no calcule como porcentaje.
          next.unit = "UN";
        }
        return next;
      }),
    });
  }

  // Al cambiar la UNIDAD: si pasa a "%" en mano_obra → leyes sociales auto.
  // Si sale de "%" → limpiar appliedTo*.
  function changeCompUnit(compId: string, newUnit: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      components: draft.components.map((c) => {
        if (c.id !== compId) return c;
        const next = { ...c, unit: newUnit };
        if (newUnit === "%" && c.type === "mano_obra") {
          next.appliedToType = "mano_obra";
          next.appliedToComponentId = null;
        } else if (newUnit === "%" && c.type === "perdida") {
          next.appliedToType = "material"; // sobre todos los materiales por defecto
          next.appliedToComponentId = null;
        } else if (newUnit !== "%") {
          next.appliedToComponentId = null;
          next.appliedToType = null;
        }
        return next;
      }),
    });
  }

  // Para pérdida con unit="%": elegir sobre qué se aplica.
  //   - "__ALL__"  → sobre TODOS los materiales (appliedToType="material").
  //   - <id>       → sobre ese material concreto (appliedToComponentId).
  //   - null/""    → sin objetivo (queda en $0).
  function pickAppliedTo(compId: string, value: string | null) {
    if (!draft) return;
    setDraft({
      ...draft,
      components: draft.components.map((c) => {
        if (c.id !== compId) return c;
        if (value === "__ALL__") {
          return { ...c, appliedToComponentId: null, appliedToType: "material" };
        }
        return { ...c, appliedToComponentId: value || null, appliedToType: null };
      }),
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
    // Usa effectiveTotal — respeta la lógica de % (pérdida sobre material,
    // leyes sobre MO, margen sobre todo el resto).
    const sumByType = (type: string) =>
      active
        .filter((c) => c.type === type)
        .reduce((s, c) => s + effectiveTotal(c, active), 0);
    const costMaterial = sumByType("material");
    const costLabor = sumByType("mano_obra");
    const costTools = sumByType("herramientas");
    const costSubcontract = sumByType("subcontrato");
    const costLoss = sumByType("perdida");
    const costMargin = sumByType("margen");
    const unitPrice =
      costMaterial + costLabor + costTools + costSubcontract + costLoss + costMargin;
    return { costMaterial, costLabor, costTools, costSubcontract, costLoss, costMargin, unitPrice };
  }

  // Guarda SOLO la descripción para cliente, editada inline en la fila.
  // Mismo patrón que la cotización (PR #216): el RichTextEditor dispara su
  // onChange al SALIR del campo (blur), no en cada tecla, así que esto corre
  // una sola vez al terminar. Actualiza el estado local de inmediato (para que
  // la fila refleje el cambio sin recargar) y persiste con un PUT parcial que
  // toca únicamente descriptionCliente (la API ya soporta updates parciales).
  async function saveDescCliente(id: string, html: string) {
    const value = isRichTextEmpty(html) ? null : html;
    setPartidas((prev) =>
      prev.map((p) => (p.id === id ? { ...p, descriptionCliente: value } : p))
    );
    setEditingDescId(null);
    try {
      await fetch(`/api/catalogo/partidas/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descriptionCliente: value }),
      });
    } catch {
      alert("Error al guardar la descripción");
    }
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
          // La descripción para cliente se edita INLINE en la fila (no acá),
          // así que NO la mandamos desde el panel para no pisar ese cambio.
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
      // Para guardar bien los totalCost de componentes con unit="%"
      // (pérdida sobre material, leyes sobre MO, margen), hay que crear
      // primero los nuevos y luego actualizar todos con el totalCost
      // calculado (porque los % pueden depender de IDs reales en BD).
      // Para simplificar: persistimos el snapshot de totales según los
      // ids actuales (los _new cuando se persisten generan ID nuevo, así
      // que appliedToComponentId apuntando a un _new no funciona en el
      // primer save — MJ tiene que guardar y después configurar la pérdida).
      const allActive = draft.components.filter((c) => !c._deleted);
      const toCreate = allActive.filter((c) => c._new);
      for (const c of toCreate) {
        const total = effectiveTotal(c, allActive);
        await fetch(`/api/catalogo/partidas/${draft.id}/componentes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: c.type,
            description: c.description,
            unit: c.unit,
            quantity: c.quantity,
            unitCost: c.unitCost,
            totalCost: total,
            sortOrder: c.sortOrder,
            materialId: c.materialId ?? null,
            referenceLink: c.referenceLink ?? null,
            appliedToComponentId: c.appliedToComponentId ?? null,
            appliedToType: c.appliedToType ?? null,
          }),
        });
      }
      const toUpdate = allActive.filter((c) => !c._new);
      for (const c of toUpdate) {
        const total = effectiveTotal(c, allActive);
        await fetch(
          `/api/catalogo/partidas/${draft.id}/componentes/${c.id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: c.type,
              description: c.description,
              unit: c.unit,
              quantity: c.quantity,
              unitCost: c.unitCost,
              totalCost: total,
              sortOrder: c.sortOrder,
              materialId: c.materialId ?? null,
              referenceLink: c.referenceLink ?? null,
              appliedToComponentId: c.appliedToComponentId ?? null,
              appliedToType: c.appliedToType ?? null,
            }),
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

  // Crea una partida en blanco en el catálogo y la abre directamente en
  // modo edición, para que MJ cargue las descripciones y componentes.
  async function createPartida() {
    const name = newForm.name.trim().toUpperCase();
    const newCategory = newForm.category.trim().toUpperCase();
    if (!name || !newCategory) {
      alert("Nombre y categoría son obligatorios");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/catalogo/partidas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, category: newCategory, unit: newForm.unit }),
      });
      if (!res.ok) {
        alert("Error al crear partida");
        return;
      }
      const created = await res.json();
      // El POST devuelve la partida sin componentes — la completamos para
      // que el editor (que espera components) no falle.
      const fullPartida: Partida = { ...created, components: [] };
      if (!allCategories.includes(newCategory)) {
        setAllCategories((prev) => [...prev, newCategory]);
      }
      setPartidas((prev) => [...prev, fullPartida]);
      setCreating(false);
      setNewForm({ name: "", category: "", unit: "GL" });
      // Si hay un filtro de categoría activo que no coincide, lo limpiamos
      // para que la partida recién creada sea visible.
      if (category && category !== newCategory) setCategory("");
      startEdit(fullPartida);
    } catch {
      alert("Error al crear partida");
    } finally {
      setSaving(false);
    }
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
    const orderedCategories = allCategories
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
  }, [allCategories, category, partidas]);

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
          {allCategories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
        <button
          onClick={() => setCreating((v) => !v)}
          className="px-3 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-700 whitespace-nowrap"
        >
          + Nueva partida
        </button>
      </div>

      {/* Formulario de creación rápida — abre la partida en modo edición */}
      {creating && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">
            Nueva partida
          </div>
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-6">
              <label className="text-[10px] uppercase tracking-wider text-gray-500 block mb-1">
                Nombre
              </label>
              <input
                value={newForm.name}
                onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
                placeholder="Ej: PINTURA MURO INTERIOR"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm uppercase focus:ring-1 focus:ring-gray-900 outline-none"
              />
            </div>
            <div className="col-span-3">
              <label className="text-[10px] uppercase tracking-wider text-gray-500 block mb-1">
                Categoría
              </label>
              <input
                list="catalogo-categorias"
                value={newForm.category}
                onChange={(e) =>
                  setNewForm({ ...newForm, category: e.target.value })
                }
                placeholder="Existente o nueva"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm uppercase focus:ring-1 focus:ring-gray-900 outline-none"
              />
              <datalist id="catalogo-categorias">
                {allCategories.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </div>
            <div className="col-span-3">
              <label className="text-[10px] uppercase tracking-wider text-gray-500 block mb-1">
                Unidad
              </label>
              <select
                value={newForm.unit}
                onChange={(e) => setNewForm({ ...newForm, unit: e.target.value })}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white focus:ring-1 focus:ring-gray-900 outline-none"
              >
                {PARTIDA_UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => {
                setCreating(false);
                setNewForm({ name: "", category: "", unit: "GL" });
              }}
              className="text-sm px-4 py-1.5 border border-gray-300 rounded hover:bg-gray-100"
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              onClick={createPartida}
              disabled={saving}
              className="text-sm px-4 py-1.5 bg-gray-900 text-white rounded hover:bg-gray-700 disabled:opacity-50"
            >
              {saving ? "Creando…" : "Crear y editar"}
            </button>
          </div>
        </div>
      )}

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
            <div className="grid grid-cols-[4.5rem_minmax(0,2fr)_minmax(0,3fr)_3rem_6rem_5rem] items-center gap-3 px-4 py-2 border-y-2 border-gray-900 bg-white text-[11px] font-bold text-gray-900 uppercase tracking-wider">
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
                    isFocused={highlightId === partida.id}
                    isEditingDesc={editingDescId === partida.id}
                    draft={editing === partida.id ? draft : null}
                    saving={saving}
                    savedFlash={savedFlash === partida.id}
                    onToggleExpand={() =>
                      setExpanded(
                        expanded === partida.id && editing !== partida.id ? null : partida.id
                      )
                    }
                    onStartEditDesc={() => setEditingDescId(partida.id)}
                    onSaveDescCliente={(html) => saveDescCliente(partida.id, html)}
                    onStartEdit={() => startEdit(partida)}
                    onCancelEdit={cancelEdit}
                    onSaveEdit={saveEdit}
                    onUpdateDraft={(patch) =>
                      setDraft(draft ? { ...draft, ...patch } : null)
                    }
                    onUpdateDraftComp={updateDraftComp}
                    onAddComponent={addComponent}
                    onRemoveComponent={removeComponent}
                    onReorderComps={reorderComps}
                    onSelectMaterial={selectMaterial}
                    onChangeCompType={changeCompType}
                    onChangeCompUnit={changeCompUnit}
                    onPickAppliedTo={pickAppliedTo}
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
  isFocused,
  isEditingDesc,
  draft,
  saving,
  savedFlash,
  onToggleExpand,
  onStartEditDesc,
  onSaveDescCliente,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onUpdateDraft,
  onUpdateDraftComp,
  onAddComponent,
  onRemoveComponent,
  onReorderComps,
  onSelectMaterial,
  onChangeCompType,
  onChangeCompUnit,
  onPickAppliedTo,
  onDuplicate,
  onDelete,
  recalcCosts,
}: {
  partida: Partida;
  chapterIndex: number;
  rowIndex: number;
  isExpanded: boolean;
  isEditing: boolean;
  isFocused: boolean;
  isEditingDesc: boolean;
  draft: Partida | null;
  saving: boolean;
  savedFlash: boolean;
  onToggleExpand: () => void;
  onStartEditDesc: () => void;
  onSaveDescCliente: (html: string) => void;
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
  onReorderComps: (orderedIds: string[]) => void;
  onSelectMaterial: (
    compId: string,
    material: { id: string; name: string; unit: string; netPrice: number }
  ) => void;
  onChangeCompType: (compId: string, newType: string) => void;
  onChangeCompUnit: (compId: string, newUnit: string) => void;
  onPickAppliedTo: (compId: string, targetCompId: string | null) => void;
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
    <div ref={setNodeRef} style={style} id={`partida-row-${partida.id}`}>
      <div
        className={`grid grid-cols-[4.5rem_minmax(0,2fr)_minmax(0,3fr)_3rem_6rem_5rem] items-center gap-3 px-4 py-1.5 border-b border-gray-100 hover:bg-gray-50/60 group ${
          isExpanded ? "bg-gray-50/60" : ""
        } ${savedFlash ? "bg-green-50" : ""} ${
          isFocused ? "ring-2 ring-inset ring-gray-900" : ""
        }`}
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
          <button
            onClick={onToggleExpand}
            className="text-gray-400 hover:text-gray-700 text-xs"
            title={isExpanded ? "Colapsar" : "Expandir"}
          >
            {isExpanded ? "▾" : "▸"}
          </button>
          {num}
        </div>
        <button
          onClick={onToggleExpand}
          className="text-left text-xs text-gray-900 uppercase font-medium truncate"
          title={partida.name}
        >
          {partida.name}
        </button>
        {/* DESCRIPCIÓN PARA CLIENTE (la que va al PDF). Se edita INLINE acá
            mismo, igual que en las cotizaciones: un clic monta el editor de
            texto con formato (barra flotante) y al salir guarda y vuelve a la
            vista. La del MAESTRO vive solo en el panel expandido (▾). */}
        {isEditingDesc ? (
          <div className="[&_.ProseMirror]:!text-[11px] [&_.ProseMirror]:!leading-snug [&_.ProseMirror]:!min-h-[18px] [&_.ProseMirror]:!py-0.5 [&_.ProseMirror]:!px-1.5 [&_.ProseMirror_p]:!my-0 [&_.ProseMirror_li]:!my-0">
            <RichTextEditor
              value={partida.descriptionCliente}
              autoFocus
              placeholder="Descripción para el cliente (PDF)…"
              onChange={(html) => {
                // RichTextEditor dispara onChange en blur (al salir): guarda
                // el texto final y vuelve a la vista de la fila.
                onSaveDescCliente(html);
              }}
            />
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            onClick={onStartEditDesc}
            title="Clic para editar la descripción del cliente acá mismo"
            className="text-left text-[11px] text-gray-500 truncate cursor-text min-h-[14px] [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:my-0.5"
          >
            {isRichTextEmpty(partida.descriptionCliente) ? (
              <span className="text-gray-300">—</span>
            ) : (
              <span
                dangerouslySetInnerHTML={{
                  __html: sanitizeRichTextHtml(partida.descriptionCliente),
                }}
              />
            )}
          </div>
        )}
        <div className="text-center">
          <span className="text-[11px] text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
            {partida.unit}
          </span>
        </div>
        <div className="text-right text-xs font-medium text-gray-900 tabular-nums">
          {formatCLP(partida.unitPrice)}
        </div>
        {/* Duplicar de un toque, sin tener que expandir la partida. Aparece al
            pasar el mouse por la fila. Mismo botón que en el panel desplegado. */}
        <div className="text-right">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
            className="text-[11px] text-gray-400 hover:text-gray-900 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Duplicar esta partida en el catálogo"
          >
            Duplicar
          </button>
        </div>
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
              onReorderComps={onReorderComps}
              onSelectMaterial={onSelectMaterial}
              onChangeCompType={onChangeCompType}
              onChangeCompUnit={onChangeCompUnit}
              onPickAppliedTo={onPickAppliedTo}
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
      {/* Descripción para maestro. La del CLIENTE ya no vive acá: se edita
          inline en la fila (clic sobre la columna de descripción), igual que
          en las cotizaciones. El desplegable muestra solo la del maestro. */}
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
                {sortForDisplay(partida.components).map((c) => {
                  const allActive = partida.components.filter((x) => !x._deleted);
                  return (
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
                      {/* Si el material está ligado al catálogo (materialId),
                          su nombre lleva a la ficha en /materiales para editarlo
                          (cambiar precio, link, nombre). Distinto de la flecha ↗,
                          que abre el producto en la tienda externa. */}
                      {c.type === "material" && c.materialId ? (
                        <Link
                          href={`/catalogo/materiales?focus=${c.materialId}`}
                          className="hover:underline decoration-gray-400 underline-offset-2 cursor-pointer"
                          title="Editar este material en el catálogo"
                        >
                          {c.description}
                        </Link>
                      ) : (
                        c.description
                      )}
                      {/* La flecha (link a producto) solo tiene sentido para
                          materiales/herramientas/subcontrato. Pérdida, margen
                          y leyes sociales NO son productos linkeables. */}
                      {c.referenceLink &&
                        c.type !== "perdida" &&
                        c.type !== "margen" &&
                        !(c.type === "mano_obra" && c.unit === "%") && (
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
                    <td
                      className={`py-1 px-2 text-right tabular-nums ${
                        c.type === "mano_obra" ? "text-red-700" : "text-gray-700"
                      }`}
                    >
                      {c.unit === "%" ? (
                        <span className="text-[10px] text-gray-400 italic">
                          {c.type === "perdida"
                            ? "sobre material"
                            : c.type === "mano_obra"
                              ? "sobre M.O."
                              : c.type === "margen"
                                ? "sobre resto"
                                : "—"}
                        </span>
                      ) : (
                        formatCLP(c.unitCost)
                      )}
                    </td>
                    {/* Mano de obra en rojo ladrillo apagado (mismo tono que la
                        Pérdida), a propósito: resalta lo que MJ negocia con el
                        maestro. */}
                    <td
                      className={`py-1 px-2 text-right font-medium tabular-nums ${
                        c.type === "mano_obra" ? "text-red-700" : "text-gray-900"
                      }`}
                    >
                      {formatCLP(effectiveTotal(c, allActive))}
                    </td>
                  </tr>
                  );
                })}
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
  onReorderComps,
  onSelectMaterial,
  onChangeCompType,
  onChangeCompUnit,
  onPickAppliedTo,
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
  onReorderComps: (orderedIds: string[]) => void;
  onSelectMaterial: (
    compId: string,
    material: { id: string; name: string; unit: string; netPrice: number }
  ) => void;
  onChangeCompType: (compId: string, newType: string) => void;
  onChangeCompUnit: (compId: string, newUnit: string) => void;
  onPickAppliedTo: (compId: string, targetCompId: string | null) => void;
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
            {PARTIDA_UNITS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Solo la descripción para maestro. La del CLIENTE se edita inline en
          la fila (no acá), igual que en las cotizaciones. */}
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
        <ComponentsEditTable
          draft={draft}
          totalUnitPrice={costs.unitPrice}
          onUpdateDraftComp={onUpdateDraftComp}
          onRemoveComponent={onRemoveComponent}
          onReorderComps={onReorderComps}
          onSelectMaterial={onSelectMaterial}
          onChangeCompType={onChangeCompType}
          onChangeCompUnit={onChangeCompUnit}
          onPickAppliedTo={onPickAppliedTo}
        />
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

// ============================================================================
// ComponentsEditTable — tabla de componentes editable, drag & drop sobre
// los componentes regulares (5d) y autocomplete de materiales (5b).
// Los componentes tipo "margen" se anclan al final, no son draggables (5a).
// ============================================================================
function ComponentsEditTable({
  draft,
  totalUnitPrice,
  onUpdateDraftComp,
  onRemoveComponent,
  onReorderComps,
  onSelectMaterial,
  onChangeCompType,
  onChangeCompUnit,
  onPickAppliedTo,
}: {
  draft: Partida;
  totalUnitPrice: number;
  onUpdateDraftComp: (
    compId: string,
    field: keyof Component,
    value: string | number
  ) => void;
  onRemoveComponent: (compId: string) => void;
  onReorderComps: (orderedIds: string[]) => void;
  onSelectMaterial: (
    compId: string,
    material: { id: string; name: string; unit: string; netPrice: number }
  ) => void;
  onChangeCompType: (compId: string, newType: string) => void;
  onChangeCompUnit: (compId: string, newUnit: string) => void;
  onPickAppliedTo: (compId: string, targetCompId: string | null) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const visible = draft.components.filter((c) => !c._deleted);
  const sorted = sortForDisplay(visible);
  const regulares = sorted.filter((c) => c.type !== "margen");
  const margen = sorted.filter((c) => c.type === "margen");

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = regulares.findIndex((c) => c.id === active.id);
    const newIdx = regulares.findIndex((c) => c.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(regulares, oldIdx, newIdx);
    onReorderComps(reordered.map((c) => c.id));
  }

  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="border-y border-gray-300 text-gray-500 uppercase tracking-wider">
          <th className="w-6"></th>
          <th className="text-left py-1 px-1 w-28 font-semibold">Tipo</th>
          <th className="text-left py-1 px-1 font-semibold">Descripción</th>
          <th className="text-center py-1 px-1 w-14 font-semibold">Un.</th>
          <th className="text-right py-1 px-1 w-20 font-semibold">Cant.</th>
          <th className="text-right py-1 px-1 w-24 font-semibold">Costo</th>
          <th className="text-right py-1 px-1 w-24 font-semibold">Total</th>
          <th className="w-6"></th>
        </tr>
      </thead>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={regulares.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          <tbody>
            {regulares.map((comp) => (
              <ComponentEditRow
                key={comp.id}
                comp={comp}
                draggable
                allActive={visible}
                onUpdate={onUpdateDraftComp}
                onRemove={onRemoveComponent}
                onSelectMaterial={onSelectMaterial}
                onChangeType={onChangeCompType}
                onChangeUnit={onChangeCompUnit}
                onPickAppliedTo={onPickAppliedTo}
              />
            ))}
            {margen.map((comp) => (
              <ComponentEditRow
                key={comp.id}
                comp={comp}
                draggable={false}
                allActive={visible}
                onUpdate={onUpdateDraftComp}
                onRemove={onRemoveComponent}
                onSelectMaterial={onSelectMaterial}
                onChangeType={onChangeCompType}
                onChangeUnit={onChangeCompUnit}
                onPickAppliedTo={onPickAppliedTo}
              />
            ))}
            <tr className="border-t-2 border-gray-900">
              <td colSpan={6} className="py-1.5 px-1 text-right uppercase text-[10px] font-bold tracking-wider text-gray-900">
                P.U. calculado
              </td>
              <td className="py-1.5 px-1 text-right font-bold text-gray-900 tabular-nums">
                {formatCLP(totalUnitPrice)}
              </td>
              <td></td>
            </tr>
          </tbody>
        </SortableContext>
      </DndContext>
    </table>
  );
}

function ComponentEditRow({
  comp,
  draggable,
  allActive,
  onUpdate,
  onRemove,
  onSelectMaterial,
  onChangeType,
  onChangeUnit,
  onPickAppliedTo,
}: {
  comp: Component;
  draggable: boolean;
  allActive: Component[];
  onUpdate: (
    compId: string,
    field: keyof Component,
    value: string | number
  ) => void;
  onRemove: (compId: string) => void;
  onSelectMaterial: (
    compId: string,
    material: { id: string; name: string; unit: string; netPrice: number }
  ) => void;
  onChangeType: (compId: string, newType: string) => void;
  onChangeUnit: (compId: string, newUnit: string) => void;
  onPickAppliedTo: (compId: string, targetCompId: string | null) => void;
}) {
  // Solo los regulares son sortables — los margen se renderizan sin hooks
  // de dnd-kit (no están dentro del SortableContext anyway).
  const sortable = useSortable({ id: comp.id, disabled: !draggable });
  const style = draggable
    ? {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0.5 : 1,
      }
    : undefined;

  return (
    <tr
      ref={draggable ? sortable.setNodeRef : undefined}
      style={style}
      className="border-b border-gray-100"
    >
      <td className="py-1 px-1 text-center text-gray-300">
        {draggable ? (
          <span
            {...sortable.attributes}
            {...sortable.listeners}
            className="cursor-grab hover:text-gray-700 inline-block"
            title="Arrastrar para reordenar"
          >
            ⋮⋮
          </span>
        ) : (
          <span className="text-gray-200" title="El margen siempre va al final">
            ·
          </span>
        )}
      </td>
      <td className="py-1 px-1">
        <select
          value={comp.type}
          onChange={(e) => onChangeType(comp.id, e.target.value)}
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
        {comp.type === "material" ? (
          <MaterialAutocomplete
            value={comp.description}
            onChange={(v) => onUpdate(comp.id, "description", v)}
            onSelect={(m) => onSelectMaterial(comp.id, m)}
            placeholder="Buscar material…"
          />
        ) : (
          <input
            value={comp.description}
            onChange={(e) => onUpdate(comp.id, "description", e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1 text-[11px]"
            placeholder={
              comp.type === "mano_obra" && comp.unit === "%"
                ? "Leyes sociales"
                : "Descripción"
            }
          />
        )}
      </td>
      <td className="py-1 px-1">
        <select
          value={comp.unit}
          onChange={(e) => onChangeUnit(comp.id, e.target.value)}
          className="w-full border border-gray-300 rounded px-1 py-1 text-[11px] text-center bg-white"
        >
          {["UN", "M2", "ML", "M3", "KG", "GL", "DIA", "HR", "%"].map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </td>
      <td className="py-1 px-1">
        <input
          type="number"
          step={comp.unit === "%" ? "0.1" : "0.001"}
          value={comp.quantity}
          onChange={(e) => onUpdate(comp.id, "quantity", parseFloat(e.target.value) || 0)}
          className="w-full border border-gray-300 rounded px-1 py-1 text-[11px] text-right tabular-nums"
          title={comp.unit === "%" ? "Porcentaje" : "Cantidad"}
        />
      </td>
      <td className="py-1 px-1">
        {comp.unit === "%" && comp.type === "perdida" ? (
          // Pérdida sobre un material concreto (5c)
          <select
            value={
              comp.appliedToType === "material"
                ? "__ALL__"
                : comp.appliedToComponentId ?? ""
            }
            onChange={(e) =>
              onPickAppliedTo(comp.id, e.target.value || null)
            }
            className="w-full border border-gray-300 rounded px-1 py-1 text-[10px] bg-white"
            title="Sobre qué aplicar la pérdida"
          >
            <option value="">— elegir —</option>
            <option value="__ALL__">Todos los materiales</option>
            {allActive
              .filter((c) => c.type === "material" && c.id !== comp.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.description.slice(0, 30) || "(sin descripción)"}
                </option>
              ))}
          </select>
        ) : comp.unit === "%" && comp.type === "mano_obra" ? (
          // Leyes sociales: read-only, aplicado a la suma de MO (5e)
          <span className="block w-full text-[10px] text-gray-500 italic px-1 py-1 text-center">
            sobre Mano de Obra
          </span>
        ) : comp.unit === "%" && comp.type === "margen" ? (
          // Margen: read-only, aplicado a todo el resto excepto pérdida
          <span className="block w-full text-[10px] text-gray-500 italic px-1 py-1 text-center">
            sobre el resto
          </span>
        ) : (
          <input
            type="number"
            step="1"
            value={Math.round(comp.unitCost)}
            onChange={(e) => onUpdate(comp.id, "unitCost", parseFloat(e.target.value) || 0)}
            className={`w-full border border-gray-300 rounded px-1 py-1 text-[11px] text-right tabular-nums ${
              comp.type === "mano_obra" ? "text-red-700" : ""
            }`}
          />
        )}
      </td>
      {/* Mano de obra en rojo ladrillo apagado (mismo tono que la Pérdida). */}
      <td
        className={`py-1 px-1 text-right font-medium tabular-nums ${
          comp.type === "mano_obra" ? "text-red-700" : "text-gray-700"
        }`}
      >
        {formatCLP(effectiveTotal(comp, allActive))}
      </td>
      <td className="py-1 px-1 text-center">
        <button
          onClick={() => onRemove(comp.id)}
          className="text-gray-300 hover:text-red-500"
          title="Eliminar"
        >
          ✕
        </button>
      </td>
    </tr>
  );
}
