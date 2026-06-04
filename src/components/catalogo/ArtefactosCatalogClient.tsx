"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { formatCLP, formatNumber } from "@/lib/utils";
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

interface CatalogItem {
  id: string;
  name: string;
  detail: string | null;
  brand: string | null;
  subcategory: string;
  tag: string | null;
  supplier: string | null;
  referenceLink: string | null;
  imageUrl: string | null;
  listPrice: number;
  discountPercent: number | null;
  isStandard: boolean;
  sortOrder: number;
  lastPriceCheck: Date | string | null;
}

const SUBCATEGORY_LABELS: Record<string, string> = {
  sanitario: "Sanitario",
  cocina: "Cocina",
  iluminacion: "Iluminación",
};

const SUBCATEGORY_OPTIONS = ["sanitario", "cocina", "iluminacion"];

// Layout de columnas compartido entre el encabezado y cada fila. La primera
// columna angosta es la manija para arrastrar.
const GRID_COLS =
  "grid-cols-[1.5rem_5rem_minmax(0,1.2fr)_minmax(0,2fr)_9rem_7rem_5rem_3rem]";

// Input numérico con separadores de miles.
function ThousandsInput({
  value,
  onChange,
  className = "",
  placeholder,
}: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  const display = focused
    ? value === 0
      ? ""
      : String(value)
    : value === 0
    ? ""
    : formatNumber(value);
  return (
    <input
      type={focused ? "number" : "text"}
      inputMode="numeric"
      value={display}
      placeholder={placeholder}
      onFocus={(e) => {
        setFocused(true);
        setTimeout(() => e.target.select(), 0);
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      className={className}
    />
  );
}

export default function ArtefactosCatalogClient({
  initialItems,
}: {
  initialItems: CatalogItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<CatalogItem[]>(initialItems);
  const [activeTab, setActiveTab] = useState<string>("sanitario");
  const [query, setQuery] = useState("");
  const [onlyStandard, setOnlyStandard] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newItem, setNewItem] = useState({
    name: "",
    detail: "",
    brand: "",
    subcategory: "sanitario",
    tag: "",
    supplier: "",
    referenceLink: "",
    imageUrl: "",
    listPrice: 0,
    discountPercent: 0,
    isStandard: false,
  });
  const [extractingForNew, setExtractingForNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Conteo por pestaña (sobre el universo completo, sin filtros) ──────
  const countsByTab = useMemo(() => {
    const c: Record<string, number> = { sanitario: 0, cocina: 0, iluminacion: 0 };
    for (const it of items) {
      if (c[it.subcategory] !== undefined) c[it.subcategory]++;
    }
    return c;
  }, [items]);

  // ── Items de la pestaña activa, ordenados por sortOrder ───────────────
  // Este es el orden "real" del tab (sin filtros) — la base para arrastrar.
  const tabItems = useMemo(() => {
    return items
      .filter((it) => it.subcategory === activeTab)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }, [items, activeTab]);

  // Si hay búsqueda o el filtro de estándares está activo, no se puede
  // arrastrar (estaríamos reordenando sobre una vista parcial). El arrastre
  // se hace sobre la lista completa de la pestaña.
  const isFiltering = query.trim() !== "" || onlyStandard;

  // ── Lista visible: aplica búsqueda + estándares sobre tabItems ────────
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tabItems.filter((it) => {
      if (onlyStandard && !it.isStandard) return false;
      if (q) {
        const hay = [
          it.name,
          it.detail ?? "",
          it.brand ?? "",
          it.supplier ?? "",
          it.tag ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tabItems, query, onlyStandard]);

  // ── Drag & drop ───────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = tabItems.findIndex((it) => it.id === active.id);
    const newIdx = tabItems.findIndex((it) => it.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(tabItems, oldIdx, newIdx);

    // Optimista: reasigna sortOrder consecutivo a toda la pestaña.
    const orderMap = new Map(reordered.map((it, i) => [it.id, i]));
    setItems((prev) =>
      prev.map((it) =>
        orderMap.has(it.id) ? { ...it, sortOrder: orderMap.get(it.id)! } : it
      )
    );

    // Persistir.
    try {
      await fetch("/api/catalogo/artefactos/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: reordered.map((it, i) => ({ id: it.id, sortOrder: i })),
        }),
      });
    } catch {
      alert("Error al guardar el orden");
      router.refresh();
    }
  }

  // ── Mutaciones ────────────────────────────────────────────────────────
  async function persistItem(item: CatalogItem) {
    try {
      await fetch(`/api/catalogo/artefactos/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
    } catch {
      /* silent */
    }
  }

  function updateItem(id: string, patch: Partial<CatalogItem>) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const merged = { ...it, ...patch };
        persistItem(merged);
        return merged;
      })
    );
  }

  async function deleteItem(id: string) {
    if (!confirm("¿Borrar este item del catálogo?")) return;
    try {
      await fetch(`/api/catalogo/artefactos/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((it) => it.id !== id));
    } catch {
      alert("Error al borrar");
    }
  }

  async function handleAddNew() {
    if (!newItem.name.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setError(null);
    try {
      const res = await fetch("/api/catalogo/artefactos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newItem),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Error");
      }
      const created = await res.json();
      setItems((prev) => [...prev, created]);
      // Saltar a la pestaña donde quedó el artefacto recién creado.
      setActiveTab(created.subcategory);
      setNewItem({
        name: "",
        detail: "",
        brand: "",
        subcategory: activeTab,
        tag: "",
        supplier: "",
        referenceLink: "",
        imageUrl: "",
        listPrice: 0,
        discountPercent: 0,
        isStandard: false,
      });
      setAdding(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    }
  }

  // Extraer datos al pegar URL en el formulario de "nuevo item".
  async function handleExtractForNew() {
    if (!newItem.referenceLink) {
      setError("Pegá un link primero.");
      return;
    }
    setExtractingForNew(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/catalogo/artefactos/extract?url=${encodeURIComponent(
          newItem.referenceLink
        )}`
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo extraer");
        return;
      }
      setNewItem((prev) => ({
        ...prev,
        imageUrl: data.imageUrl ?? prev.imageUrl,
        detail: data.name ?? prev.detail,
        brand: data.brand ?? prev.brand,
        listPrice: data.listPrice ?? prev.listPrice,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setExtractingForNew(false);
    }
  }

  // ── Render: filas + encabezados de grupo por tag ──────────────────────
  // Recorremos la lista visible y, cada vez que el tag cambia respecto a la
  // fila anterior, insertamos un encabezado con el tipo. Las filas sin tag
  // no muestran encabezado (evita ruido).
  const rows: ReactNode[] = [];
  let prevTag = " "; // centinela imposible para forzar el primer chequeo
  for (const item of visible) {
    const tagKey = (item.tag ?? "").trim();
    if (tagKey !== prevTag) {
      if (tagKey) {
        rows.push(
          <div
            key={`hdr-${item.id}`}
            className="px-4 py-1.5 bg-gray-50 border-b border-gray-200 text-[10px] font-semibold text-gray-500 uppercase tracking-wider"
          >
            {tagKey}
          </div>
        );
      }
      prevTag = tagKey;
    }
    rows.push(
      <CatalogItemRow
        key={item.id}
        item={item}
        canReorder={!isFiltering}
        onUpdate={(patch) => updateItem(item.id, patch)}
        onDelete={() => deleteItem(item.id)}
      />
    );
  }

  return (
    <div>
      {/* Pestañas de subcategoría */}
      <div className="flex items-center gap-2 mb-4">
        {SUBCATEGORY_OPTIONS.map((s) => {
          const active = activeTab === s;
          return (
            <button
              key={s}
              onClick={() => setActiveTab(s)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                active
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
              }`}
            >
              {SUBCATEGORY_LABELS[s]}
              <span
                className={`ml-2 tabular-nums ${
                  active ? "text-gray-300" : "text-gray-400"
                }`}
              >
                {countsByTab[s] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* Toolbar: búsqueda + filtros + nuevo */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre, marca, proveedor…"
          className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-gray-500"
        />
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyStandard}
            onChange={(e) => setOnlyStandard(e.target.checked)}
            className="accent-gray-900"
          />
          Solo paleta estándar BLARQ
        </label>
        <button
          onClick={() => {
            // El formulario nuevo arranca en la pestaña activa.
            setNewItem((prev) => ({ ...prev, subcategory: activeTab }));
            setAdding(!adding);
          }}
          className="ml-auto text-sm bg-gray-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-800"
        >
          {adding ? "Cancelar" : "+ Nuevo artefacto"}
        </button>
      </div>

      {/* Formulario de creación */}
      {adding && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
            Nuevo artefacto
          </h2>

          {/* Atajo: link del producto + extraer */}
          <div className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-3">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Atajo — pegá link del producto y extraé todo de una
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={newItem.referenceLink}
                onChange={(e) =>
                  setNewItem({ ...newItem, referenceLink: e.target.value })
                }
                placeholder="https://www.mk.cl/…"
                className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs outline-none focus:border-gray-500"
              />
              <button
                onClick={handleExtractForNew}
                disabled={extractingForNew || !newItem.referenceLink}
                className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded hover:bg-gray-800 disabled:opacity-50 whitespace-nowrap"
              >
                {extractingForNew ? "Buscando…" : "Extraer"}
              </button>
            </div>
            <p className="text-[10px] text-gray-500 mt-1">
              Trae imagen, nombre, marca y precio lista. Después podés ajustar.
            </p>
          </div>

          {error && (
            <div className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Nombre (corto) *
              </label>
              <input
                type="text"
                value={newItem.name}
                onChange={(e) =>
                  setNewItem({ ...newItem, name: e.target.value })
                }
                placeholder="WC ATENAS"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Detalle / modelo
              </label>
              <input
                type="text"
                value={newItem.detail}
                onChange={(e) =>
                  setNewItem({ ...newItem, detail: e.target.value })
                }
                placeholder="WC Two Piece ATENAS DESCARGA A MURO"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Marca
              </label>
              <input
                type="text"
                value={newItem.brand}
                onChange={(e) =>
                  setNewItem({ ...newItem, brand: e.target.value })
                }
                placeholder="KLIPEN"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Proveedor / tienda
              </label>
              <input
                type="text"
                value={newItem.supplier}
                onChange={(e) =>
                  setNewItem({ ...newItem, supplier: e.target.value })
                }
                placeholder="MK"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Subcategoría *
              </label>
              <select
                value={newItem.subcategory}
                onChange={(e) =>
                  setNewItem({ ...newItem, subcategory: e.target.value })
                }
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500 bg-white"
              >
                {SUBCATEGORY_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {SUBCATEGORY_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Tipo (opcional, para agrupar)
              </label>
              <input
                type="text"
                value={newItem.tag}
                onChange={(e) =>
                  setNewItem({ ...newItem, tag: e.target.value })
                }
                placeholder="grifería, muebles, WC…"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Precio lista
              </label>
              <ThousandsInput
                value={newItem.listPrice}
                onChange={(v) => setNewItem({ ...newItem, listPrice: v })}
                placeholder="0"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm tabular-nums text-right outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                % descuento típico
              </label>
              <input
                type="number"
                value={
                  newItem.discountPercent
                    ? Math.round(newItem.discountPercent * 100)
                    : ""
                }
                onChange={(e) =>
                  setNewItem({
                    ...newItem,
                    discountPercent: (parseFloat(e.target.value) || 0) / 100,
                  })
                }
                placeholder="0"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm tabular-nums text-right outline-none focus:border-gray-500"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                URL de imagen (manual)
              </label>
              <input
                type="url"
                value={newItem.imageUrl}
                onChange={(e) =>
                  setNewItem({ ...newItem, imageUrl: e.target.value })
                }
                placeholder="https://…/imagen.jpg"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500"
              />
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newItem.isStandard}
                  onChange={(e) =>
                    setNewItem({ ...newItem, isStandard: e.target.checked })
                  }
                  className="accent-gray-900"
                />
                Agregar a la paleta estándar BLARQ
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-gray-100">
            <button
              onClick={() => setAdding(false)}
              className="text-xs text-gray-600 px-3 py-1.5 hover:text-gray-900"
            >
              Cancelar
            </button>
            <button
              onClick={handleAddNew}
              className="text-xs bg-gray-900 text-white px-4 py-1.5 rounded hover:bg-gray-800"
            >
              Guardar en catálogo
            </button>
          </div>
        </div>
      )}

      {/* Tabla de items */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div
          className={`grid ${GRID_COLS} items-center gap-3 px-4 py-2 border-b border-gray-200 bg-gray-50 text-[10px] font-semibold text-gray-500 uppercase tracking-wider`}
        >
          <div></div>
          <div className="text-center">Img</div>
          <div>Nombre / marca</div>
          <div>Detalle</div>
          <div>Subcat. / tipo</div>
          <div className="text-right">Precio lista / dcto</div>
          <div className="text-center">Std</div>
          <div></div>
        </div>

        {!isFiltering && tabItems.length > 1 && (
          <div className="px-4 py-1.5 bg-white border-b border-gray-100 text-[11px] text-gray-400">
            Arrastrá una fila desde la manija (⋮⋮) para ordenarla a tu gusto.
            Las filas con el mismo tipo se agrupan solas con un encabezado.
          </div>
        )}

        {visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            {tabItems.length === 0
              ? "Todavía no hay artefactos en esta pestaña. Apretá '+ Nuevo artefacto' para empezar."
              : "No hay resultados con esos filtros."}
          </div>
        ) : (
          <DndContext
            id="artefactos-catalog-dnd"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={visible.map((it) => it.id)}
              strategy={verticalListSortingStrategy}
            >
              {rows}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}

// ─── Componente: fila editable + arrastrable ────────────────────────────
function CatalogItemRow({
  item,
  canReorder,
  onUpdate,
  onDelete,
}: {
  item: CatalogItem;
  canReorder: boolean;
  onUpdate: (patch: Partial<CatalogItem>) => void;
  onDelete: () => void;
}) {
  const sortable = useSortable({ id: item.id, disabled: !canReorder });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
    zIndex: sortable.isDragging ? 10 : ("auto" as const),
    background: sortable.isDragging ? "#FAFAFA" : undefined,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={`grid ${GRID_COLS} items-center gap-3 px-4 py-2 border-b border-gray-100 last:border-b-0 text-xs hover:bg-gray-50`}
    >
      {/* Manija de arrastre */}
      <div className="flex justify-center">
        {canReorder ? (
          <span
            {...sortable.attributes}
            {...sortable.listeners}
            className="cursor-grab text-gray-300 hover:text-gray-700 select-none"
            title="Arrastrar para reordenar"
          >
            ⋮⋮
          </span>
        ) : (
          <span
            className="text-gray-200 select-none"
            title="Sacá la búsqueda y el filtro de estándares para poder reordenar"
          >
            ⋮⋮
          </span>
        )}
      </div>

      <div className="flex justify-center">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt={item.name}
            className="w-14 h-14 object-contain bg-white border border-gray-200 rounded"
          />
        ) : (
          <div className="w-14 h-14 bg-gray-100 rounded flex items-center justify-center text-gray-300 text-lg">
            —
          </div>
        )}
      </div>

      <div>
        <input
          type="text"
          value={item.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          className="w-full bg-transparent border-0 p-0 font-semibold text-gray-900 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1.5 focus:py-0.5"
        />
        <input
          type="text"
          value={item.brand ?? ""}
          placeholder="marca"
          onChange={(e) => onUpdate({ brand: e.target.value })}
          className="w-full bg-transparent border-0 p-0 text-gray-500 text-[11px] outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1.5 focus:py-0.5 mt-0.5"
        />
      </div>

      <div>
        <input
          type="text"
          value={item.detail ?? ""}
          placeholder="modelo / detalle"
          onChange={(e) => onUpdate({ detail: e.target.value })}
          className="w-full bg-transparent border-0 p-0 text-gray-700 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1.5 focus:py-0.5"
        />
        {item.referenceLink && (
          <a
            href={item.referenceLink}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-gray-400 hover:text-gray-700 underline mt-0.5 inline-block truncate max-w-full"
          >
            ↗ {item.referenceLink.replace(/^https?:\/\//, "").slice(0, 40)}
          </a>
        )}
      </div>

      <div>
        {/* Selector de subcategoría: permite mover el artefacto de pestaña. */}
        <select
          value={item.subcategory}
          onChange={(e) => onUpdate({ subcategory: e.target.value })}
          className="w-full bg-transparent border-0 p-0 text-gray-700 font-medium outline-none cursor-pointer focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1.5 focus:py-0.5"
          title="Mover a otra pestaña"
        >
          {SUBCATEGORY_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {SUBCATEGORY_LABELS[s]}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={item.tag ?? ""}
          placeholder="tipo (grifería, muebles…)"
          onChange={(e) => onUpdate({ tag: e.target.value })}
          className="w-full bg-transparent border-0 p-0 text-gray-500 text-[11px] outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1.5 focus:py-0.5 mt-0.5"
        />
      </div>

      <div className="text-right">
        <div className="tabular-nums font-medium text-gray-900">
          {formatCLP(item.listPrice)}
        </div>
        <div className="text-[11px] text-gray-500">
          {item.discountPercent
            ? `-${Math.round(item.discountPercent * 100)}%`
            : "—"}
        </div>
      </div>

      <div className="flex justify-center">
        <label className="cursor-pointer" title="Paleta estándar BLARQ">
          <input
            type="checkbox"
            checked={item.isStandard}
            onChange={(e) => onUpdate({ isStandard: e.target.checked })}
            className="accent-gray-900"
          />
        </label>
      </div>

      <div className="text-center">
        <button
          onClick={onDelete}
          className="text-gray-300 hover:text-red-600 text-lg"
          title="Borrar"
        >
          ×
        </button>
      </div>
    </div>
  );
}
