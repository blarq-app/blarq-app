"use client";

import { Fragment, useMemo, useRef, useState } from "react";
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
  listPrice: number; // precio web / lista
  discountPercent: number | null; // legacy
  clientPrice: number | null; // precio a cliente (null = igual al web)
  realCostBlarq: number | null; // mi costo (lo que paga BLARQ)
  isStandard: boolean;
  sortOrder: number;
  lastPriceCheck: Date | string | null;
}

// Total a cliente = precio lista menos el descuento. Es lo que paga el
// cliente (como la columna TOTAL del Excel de MJ). Si no hay descuento,
// el total es la lista tal cual.
function clientTotal(it: {
  listPrice: number;
  discountPercent: number | null;
}): number {
  return Math.round(it.listPrice * (1 - (it.discountPercent ?? 0)));
}

// Src a usar para mostrar una imagen. Las externas (mk.cl / CDN de la tienda)
// se sirven a través de NUESTRO proxy, para que ningún bloqueador del
// navegador las frene. Las subidas (data:) y las relativas van directo.
function imgSrc(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return `/api/catalogo/img-proxy?u=${encodeURIComponent(url)}`;
  }
  return url;
}

// Fila que devuelve el endpoint "Revisar precios" (guardado vs web ahora).
interface PriceReviewRow {
  id: string;
  name: string;
  detail: string | null;
  brand: string | null;
  referenceLink: string;
  storedListPrice: number;
  storedDiscount: number;
  storedTotal: number;
  webListPrice: number | null;
  webDiscount: number | null; // decimal 0..1
  webTotal: number | null; // lo que pagaría el cliente con el web de hoy
  delta: number | null; // webTotal - storedTotal
  status: "ok" | "sin-precio" | "error";
  applied?: boolean; // marcada como aplicada en esta sesión
}

const SUBCATEGORY_LABELS: Record<string, string> = {
  sanitario: "Sanitario",
  cocina: "Cocina",
  iluminacion: "Iluminación",
};

const SUBCATEGORY_OPTIONS = ["sanitario", "cocina", "iluminacion"];

// Tipos para agrupar (desplegable cerrado, definido con MJ). Es el campo
// "tag" del modelo; los artefactos del mismo tipo se juntan bajo un
// encabezado. "" = sin tipo (van sueltos, sin encabezado).
//
// Los tipos dependen de la pestaña (subcategoría): baños y cocina no comparten
// vocabulario (un "Horno" no tiene sentido en baños, ni una "Mampara" en
// cocina). El desplegable y el orden de los grupos usan la lista de la pestaña
// activa. Iluminación todavía no tiene tipos (todo "sin tipo").
const TIPO_OPTIONS_BY_SUB: Record<string, string[]> = {
  sanitario: ["Accesorios", "Griferías", "Duchas", "Muebles", "Mamparas", "WC"],
  cocina: [
    "Lavaplatos",
    "Griferías",
    "Hornos",
    "Encimeras",
    "Campanas",
    "Refrigeración",
    "Lavavajillas",
    "Microondas",
  ],
  iluminacion: [],
};

// Helper: tipos de una subcategoría (vacío si no está definida).
const tipoOptionsFor = (sub: string): string[] =>
  TIPO_OPTIONS_BY_SUB[sub] ?? [];

// Layout de columnas compartido entre el encabezado y cada fila. La primera
// columna angosta es la manija para arrastrar.
const GRID_COLS =
  "grid-cols-[1.25rem_3.25rem_minmax(13rem,1.8fr)_minmax(7.5rem,1.2fr)_5.25rem_4.5rem_2.5rem_5rem_4.75rem_4.5rem_2rem_4.25rem]";

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

// Toma un archivo de imagen y lo achica a una miniatura comprimida (JPEG),
// devuelta como data URL para guardar directo en imageUrl. Evita subir fotos
// de 3-5 MB: las deja en ~40-100 KB. Sin almacenamiento externo.
function fileToThumbnailDataUrl(
  file: File,
  maxSize = 600,
  quality = 0.8
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Archivo de imagen inválido"));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else if (height >= width && height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("No se pudo procesar la imagen"));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
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
  // Si está seteado, el formulario está editando ese artefacto (no creando).
  const [editingId, setEditingId] = useState<string | null>(null);
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
    clientPrice: 0,
    realCostBlarq: 0,
    discountPercent: 0,
    isStandard: false,
  });
  const [extractingForNew, setExtractingForNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── "Revisar precios" ─────────────────────────────────────────────────
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewRows, setReviewRows] = useState<PriceReviewRow[]>([]);
  const [reviewResumen, setReviewResumen] = useState<{
    conLink: number;
    cambiaron: number;
    noLeidos: number;
  } | null>(null);

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

  // Arrastrar reordena DENTRO de un grupo (mismo tipo). El orden de los
  // grupos lo fija el tipo (los de la pestaña), no el arrastre; para mover un
  // artefacto de tipo se usa el desplegable de "tipo".
  async function onDragEndGroup(e: DragEndEvent, groupItems: CatalogItem[]) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = groupItems.findIndex((it) => it.id === active.id);
    const newIdx = groupItems.findIndex((it) => it.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(groupItems, oldIdx, newIdx);

    // Optimista: reasigna sortOrder 0..n a los items de ESTE grupo. (El
    // solapamiento de sortOrder entre grupos no importa: el display ordena
    // primero por grupo y después por sortOrder dentro del grupo.)
    const orderMap = new Map(reordered.map((it, i) => [it.id, i]));
    setItems((prev) =>
      prev.map((it) =>
        orderMap.has(it.id) ? { ...it, sortOrder: orderMap.get(it.id)! } : it
      )
    );

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
        clientPrice: 0,
        realCostBlarq: 0,
        discountPercent: 0,
        isStandard: false,
      });
      setAdding(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    }
  }

  // Cierra el formulario (sea de alta o edición) y lo deja en blanco.
  function closeForm() {
    setAdding(false);
    setEditingId(null);
    setError(null);
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
      clientPrice: 0,
      realCostBlarq: 0,
      discountPercent: 0,
      isStandard: false,
    });
  }

  // Abre el formulario completo cargado con los datos de un artefacto.
  function openEdit(item: CatalogItem) {
    setAdding(false);
    setError(null);
    setEditingId(item.id);
    setNewItem({
      name: item.name,
      detail: item.detail ?? "",
      brand: item.brand ?? "",
      subcategory: item.subcategory,
      tag: item.tag ?? "",
      supplier: item.supplier ?? "",
      referenceLink: item.referenceLink ?? "",
      imageUrl: item.imageUrl ?? "",
      listPrice: item.listPrice ?? 0,
      clientPrice: item.clientPrice ?? 0,
      realCostBlarq: item.realCostBlarq ?? 0,
      discountPercent: item.discountPercent ?? 0,
      isStandard: item.isStandard,
    });
  }

  // Guarda los cambios del artefacto en edición (PUT).
  async function handleSaveEdit() {
    if (!editingId) return;
    if (!newItem.name.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setError(null);
    const patch = {
      name: newItem.name,
      detail: newItem.detail || null,
      brand: newItem.brand || null,
      subcategory: newItem.subcategory,
      tag: newItem.tag || null,
      supplier: newItem.supplier || null,
      referenceLink: newItem.referenceLink || null,
      imageUrl: newItem.imageUrl || null,
      listPrice: newItem.listPrice,
      discountPercent: newItem.discountPercent || null,
      realCostBlarq: newItem.realCostBlarq || null,
      isStandard: newItem.isStandard,
    };
    try {
      const res = await fetch(`/api/catalogo/artefactos/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Error al guardar");
      }
      setItems((prev) =>
        prev.map((it) => (it.id === editingId ? { ...it, ...patch } : it))
      );
      setActiveTab(newItem.subcategory);
      closeForm();
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
        // El precio a cliente arranca = precio web (vende al precio internet).
        clientPrice:
          data.listPrice != null && !prev.clientPrice
            ? data.listPrice
            : prev.clientPrice,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setExtractingForNew(false);
    }
  }

  // ── Revisar precios: trae el precio web de hoy y compara ──────────────
  async function handleRevisarPrecios() {
    setReviewOpen(true);
    setReviewLoading(true);
    setReviewRows([]);
    setReviewResumen(null);
    try {
      const res = await fetch("/api/catalogo/artefactos/revisar-precios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      setReviewRows(data.rows ?? []);
      setReviewResumen(data.resumen ?? null);
    } catch {
      setReviewRows([]);
      setReviewResumen(null);
      alert("No se pudieron revisar los precios.");
    } finally {
      setReviewLoading(false);
    }
  }

  // Aplica el precio del web a un artefacto: actualiza el precio lista y el
  // descuento (los dos vienen del web). El Total se recalcula solo. El costo
  // (realCostBlarq) NO se toca — es cotización aparte.
  function applyReviewRow(row: PriceReviewRow) {
    if (row.webListPrice == null) return;
    updateItem(row.id, {
      listPrice: row.webListPrice,
      discountPercent: row.webDiscount && row.webDiscount > 0 ? row.webDiscount : null,
    });
    setReviewRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, applied: true } : r))
    );
  }

  function applyAllChanged() {
    for (const row of reviewRows) {
      if (row.status === "ok" && row.delta != null && row.delta !== 0 && !row.applied) {
        applyReviewRow(row);
      }
    }
  }

  // ── Agrupado real por tipo ────────────────────────────────────────────
  // Junta TODOS los artefactos del mismo tipo bajo un solo encabezado (no
  // importa dónde estén). Orden de grupos: el del desplegable de la pestaña,
  // después tipos viejos no estándar, y "sin tipo" al final. Dentro de cada
  // grupo, el orden es por sortOrder (lo que MJ arrastra).
  const groups: { tag: string; items: CatalogItem[] }[] = (() => {
    const byTag = new Map<string, CatalogItem[]>();
    for (const it of visible) {
      const key = (it.tag ?? "").trim();
      const arr = byTag.get(key);
      if (arr) arr.push(it);
      else byTag.set(key, [it]);
    }
    const orden = tipoOptionsFor(activeTab); // tipos de la pestaña activa
    const rank = (tag: string) => {
      if (tag === "") return 100000; // sin tipo, al final
      const idx = orden.indexOf(tag);
      return idx >= 0 ? idx : 50000; // tipos viejos no estándar, antes de "sin tipo"
    };
    return [...byTag.entries()]
      .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
      .map(([tag, items]) => ({ tag, items }));
  })();

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
          onClick={handleRevisarPrecios}
          disabled={reviewLoading}
          className="ml-auto text-sm border border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium hover:border-gray-500 disabled:opacity-50"
          title="Trae el precio web de hoy para los artefactos con link y te muestra los cambios"
        >
          {reviewLoading ? "Revisando…" : "Revisar precios"}
        </button>
        <button
          onClick={() => {
            if (adding) {
              closeForm();
              return;
            }
            // Abrir alta en blanco (cierra una edición si la había).
            closeForm();
            setNewItem((prev) => ({ ...prev, subcategory: activeTab }));
            setAdding(true);
          }}
          className="text-sm bg-gray-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-800"
        >
          {adding ? "Cancelar" : "+ Nuevo artefacto"}
        </button>
      </div>

      {/* Panel de revisión de precios */}
      {reviewOpen && (
        <PriceReviewPanel
          loading={reviewLoading}
          rows={reviewRows}
          resumen={reviewResumen}
          onApply={applyReviewRow}
          onApplyAll={applyAllChanged}
          onClose={() => setReviewOpen(false)}
        />
      )}

      {/* Formulario de alta / edición. Es un <form> para que Enter guarde. */}
      {(adding || editingId) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (editingId) handleSaveEdit();
            else handleAddNew();
          }}
          className="bg-white rounded-xl border border-gray-200 p-5 mb-4"
        >
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
            {editingId ? "Editar artefacto" : "Nuevo artefacto"}
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
                type="button"
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
                Tipo (para agrupar)
              </label>
              <select
                value={newItem.tag}
                onChange={(e) =>
                  setNewItem({ ...newItem, tag: e.target.value })
                }
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500 bg-white"
              >
                <option value="">Sin tipo</option>
                {tipoOptionsFor(newItem.subcategory).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Precio lista (sin dcto)
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
                Dcto % al cliente
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
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Mi costo (oculto al cliente)
              </label>
              <ThousandsInput
                value={newItem.realCostBlarq}
                onChange={(v) => setNewItem({ ...newItem, realCostBlarq: v })}
                placeholder="lo que pago"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm tabular-nums text-right outline-none focus:border-gray-500"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Foto — subí un archivo o pegá una URL
              </label>
              <div className="flex items-center gap-2">
                {newItem.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imgSrc(newItem.imageUrl)}
                    alt="preview"
                    className="w-12 h-12 object-contain bg-white border border-gray-200 rounded shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 bg-gray-100 rounded flex items-center justify-center text-gray-300 shrink-0">
                    —
                  </div>
                )}
                <label className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded hover:bg-gray-800 cursor-pointer whitespace-nowrap">
                  Subir foto
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      try {
                        const dataUrl = await fileToThumbnailDataUrl(file);
                        setNewItem((prev) => ({ ...prev, imageUrl: dataUrl }));
                      } catch {
                        setError("No se pudo procesar la imagen.");
                      }
                    }}
                  />
                </label>
                <input
                  type="url"
                  value={newItem.imageUrl.startsWith("data:") ? "" : newItem.imageUrl}
                  onChange={(e) =>
                    setNewItem({ ...newItem, imageUrl: e.target.value })
                  }
                  placeholder="…o pegá https://…/imagen.jpg"
                  className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500"
                />
              </div>
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
              type="button"
              onClick={closeForm}
              className="text-xs text-gray-600 px-3 py-1.5 hover:text-gray-900"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="text-xs bg-gray-900 text-white px-4 py-1.5 rounded hover:bg-gray-800"
            >
              {editingId ? "Guardar cambios" : "Guardar en catálogo"}
            </button>
          </div>
        </form>
      )}

      {/* Tabla de items */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <div
          className={`grid ${GRID_COLS} items-center gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50 text-[10px] font-semibold text-gray-500 uppercase tracking-wider`}
        >
          <div></div>
          <div className="text-center">Img</div>
          <div>Nombre / marca</div>
          <div>Detalle</div>
          <div>Subcat. / tipo</div>
          <div className="text-right">Lista</div>
          <div className="text-center">Dcto</div>
          <div className="text-right">Total</div>
          <div className="text-right bg-gray-100/70 -my-2 py-2 px-1" title="No lo ve el cliente">
            Mi costo
          </div>
          <div className="text-right bg-gray-100/70 -my-2 py-2 px-1" title="No lo ve el cliente">
            Gan.
          </div>
          <div className="text-center">Std</div>
          <div></div>
        </div>

        {!isFiltering && tabItems.length > 1 && (
          <div className="px-4 py-1.5 bg-white border-b border-gray-100 text-[11px] text-gray-400">
            Los artefactos del mismo tipo quedan juntos bajo su encabezado.
            Dentro de cada tipo, arrastrá desde la manija (⋮⋮) para ordenarlos.
            Para cambiar de tipo, usá el desplegable de la fila.
          </div>
        )}

        {visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            {tabItems.length === 0
              ? "Todavía no hay artefactos en esta pestaña. Apretá '+ Nuevo artefacto' para empezar."
              : "No hay resultados con esos filtros."}
          </div>
        ) : (
          groups.map((g) => (
            <Fragment key={g.tag || "__sin_tipo__"}>
              {g.tag ? (
                <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-200 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                  {g.tag}
                </div>
              ) : (
                groups.length > 1 && (
                  <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-200 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    Sin tipo
                  </div>
                )
              )}
              <DndContext
                id={`artefactos-dnd-${g.tag || "sin-tipo"}`}
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(e) => onDragEndGroup(e, g.items)}
              >
                <SortableContext
                  items={g.items.map((it) => it.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {g.items.map((item) => (
                    <CatalogItemRow
                      key={item.id}
                      item={item}
                      canReorder={!isFiltering}
                      onUpdate={(patch) => updateItem(item.id, patch)}
                      onEdit={() => openEdit(item)}
                      onDelete={() => deleteItem(item.id)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </Fragment>
          ))
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
  onEdit,
  onDelete,
}: {
  item: CatalogItem;
  canReorder: boolean;
  onUpdate: (patch: Partial<CatalogItem>) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const sortable = useSortable({ id: item.id, disabled: !canReorder });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // URL de imagen que no cargó (rota): mostramos el "+" para subir otra en vez
  // del ícono roto. Ej.: links de mk.cl que ya no existen o están bloqueados.
  const [failedImg, setFailedImg] = useState<string | null>(null);

  // Sube una foto desde la compu: la achica a miniatura y la guarda.
  async function handlePhotoFile(file: File | undefined | null) {
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const dataUrl = await fileToThumbnailDataUrl(file);
      onUpdate({ imageUrl: dataUrl });
    } catch {
      alert("No se pudo procesar la imagen. Probá con otra.");
    } finally {
      setUploadingPhoto(false);
    }
  }
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
      className={`grid ${GRID_COLS} items-center gap-2 px-3 py-2 border-b border-gray-100 last:border-b-0 text-xs hover:bg-gray-50`}
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
        {/* Subir foto desde la compu: click abre el selector de archivo; la
            imagen se achica a miniatura y se guarda (como pidió MJ). */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            handlePhotoFile(e.target.files?.[0]);
            e.target.value = ""; // permite re-subir el mismo archivo
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Click para subir / cambiar la foto"
          className="group relative w-12 h-12"
        >
          {item.imageUrl && failedImg !== item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imgSrc(item.imageUrl)}
              alt={item.name}
              onError={() => setFailedImg(item.imageUrl)}
              className="w-12 h-12 object-contain bg-white border border-gray-200 rounded"
            />
          ) : (
            <div className="w-12 h-12 bg-gray-100 rounded flex items-center justify-center text-gray-300 text-lg">
              +
            </div>
          )}
          <span className="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/40 rounded text-white text-[9px] uppercase tracking-wider text-center leading-tight px-0.5">
            {uploadingPhoto ? "subiendo…" : "subir foto"}
          </span>
        </button>
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
        <input
          type="text"
          value={item.supplier ?? ""}
          placeholder="proveedor / tienda"
          onChange={(e) => onUpdate({ supplier: e.target.value })}
          className="w-full bg-transparent border-0 p-0 text-gray-400 text-[10px] outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1.5 focus:py-0.5"
        />
      </div>

      <div className="min-w-0">
        {/* Detalle: tipografía chica y hasta 2 líneas (los modelos son largos). */}
        <textarea
          rows={2}
          value={item.detail ?? ""}
          placeholder="modelo / detalle"
          onChange={(e) => onUpdate({ detail: e.target.value })}
          className="w-full bg-transparent border-0 p-0 text-gray-700 text-[11px] leading-tight resize-none outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1.5 focus:py-0.5"
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
        {/* Tipo: desplegable cerrado. Define el grupo (encabezado). */}
        <select
          value={item.tag ?? ""}
          onChange={(e) => onUpdate({ tag: e.target.value || null })}
          className="w-full bg-transparent border-0 p-0 text-gray-500 text-[11px] outline-none cursor-pointer focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1.5 focus:py-0.5 mt-0.5"
          title="Tipo (agrupa los artefactos)"
        >
          <option value="">sin tipo</option>
          {tipoOptionsFor(item.subcategory).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          {item.tag && !tipoOptionsFor(item.subcategory).includes(item.tag) && (
            <option value={item.tag}>{item.tag}</option>
          )}
        </select>
      </div>

      {/* Precio lista (sin descuento) */}
      <div>
        <ThousandsInput
          value={item.listPrice}
          onChange={(v) => onUpdate({ listPrice: v })}
          placeholder="0"
          className="w-full bg-transparent border-0 p-0 text-right tabular-nums text-gray-700 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5"
        />
      </div>

      {/* Descuento al cliente (auto del web cuando lo haya; editable) */}
      <div className="flex items-center justify-center gap-0.5">
        <input
          type="number"
          value={
            item.discountPercent
              ? Math.round(item.discountPercent * 100)
              : ""
          }
          onChange={(e) => {
            const pct = parseFloat(e.target.value);
            onUpdate({
              discountPercent: pct ? pct / 100 : null,
            });
          }}
          placeholder="0"
          className="w-9 bg-transparent border-0 p-0 text-right tabular-nums text-gray-700 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5"
        />
        <span className="text-gray-400 text-[10px]">%</span>
      </div>

      {/* Total = lo que paga el cliente (lista − dcto) */}
      <div className="text-right tabular-nums font-semibold text-gray-900">
        {formatCLP(clientTotal(item))}
      </div>

      {/* Mi costo (oculto al cliente) */}
      <div className="bg-gray-50 -my-2 py-2 px-1">
        <ThousandsInput
          value={item.realCostBlarq ?? 0}
          onChange={(v) => onUpdate({ realCostBlarq: v || null })}
          placeholder="—"
          className="w-full bg-transparent border-0 p-0 text-right tabular-nums text-gray-700 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5"
        />
      </div>

      {/* Ganancia = Total − Mi costo (oculto al cliente) */}
      <div className="bg-gray-50 -my-2 py-2 px-1 text-right tabular-nums">
        {item.realCostBlarq != null ? (
          <span
            className={
              clientTotal(item) - item.realCostBlarq > 0
                ? "text-green-700"
                : clientTotal(item) - item.realCostBlarq < 0
                ? "text-red-600"
                : "text-gray-500"
            }
          >
            {formatCLP(clientTotal(item) - item.realCostBlarq)}
          </span>
        ) : (
          <span className="text-gray-300">—</span>
        )}
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

      <div className="flex items-center justify-center gap-1.5">
        <button
          onClick={onEdit}
          className="text-[10px] text-gray-500 border border-gray-300 rounded px-1.5 py-0.5 hover:border-gray-500 hover:text-gray-900"
          title="Editar (abre el cuadro completo)"
        >
          Editar
        </button>
        <button
          onClick={onDelete}
          className="text-gray-300 hover:text-red-600 text-lg leading-none"
          title="Borrar"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ─── Panel "Revisar precios": guardado vs web ahora ─────────────────────
function PriceReviewPanel({
  loading,
  rows,
  resumen,
  onApply,
  onApplyAll,
  onClose,
}: {
  loading: boolean;
  rows: PriceReviewRow[];
  resumen: { conLink: number; cambiaron: number; noLeidos: number } | null;
  onApply: (row: PriceReviewRow) => void;
  onApplyAll: () => void;
  onClose: () => void;
}) {
  const COLS = "grid-cols-[minmax(0,1fr)_5.5rem_3.5rem_8rem_5rem]";
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
          Revisar precios
        </h2>
        <button
          onClick={onClose}
          className="text-xs text-gray-500 hover:text-gray-900"
        >
          Cerrar
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 py-6 text-center">
          Trayendo precios de la web…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500 py-6 text-center">
          No hay artefactos con link para revisar.
        </p>
      ) : (
        <>
          {resumen && (
            <div className="flex items-center justify-between mb-3 text-xs text-gray-600">
              <span>
                {resumen.conLink} con link ·{" "}
                <span className="text-gray-900 font-medium">
                  {resumen.cambiaron} cambiaron
                </span>
                {resumen.noLeidos > 0
                  ? ` · ${resumen.noLeidos} no se pudieron leer`
                  : ""}
              </span>
              {resumen.cambiaron > 0 && (
                <button
                  onClick={onApplyAll}
                  className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded hover:bg-gray-800"
                >
                  Aplicar todos los cambios
                </button>
              )}
            </div>
          )}

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div
              className={`grid ${COLS} gap-2 px-3 py-2 bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500 font-semibold`}
            >
              <div>Artefacto</div>
              <div className="text-right">Lista web</div>
              <div className="text-center">Dcto</div>
              <div className="text-right">Total (antes → web)</div>
              <div></div>
            </div>
            {rows.map((r) => {
              const changed =
                r.status === "ok" && r.delta != null && r.delta !== 0;
              return (
                <div
                  key={r.id}
                  className={`grid ${COLS} gap-2 px-3 py-2 border-t border-gray-100 text-xs items-center`}
                >
                  <div className="min-w-0" title={[r.name, r.brand, r.detail].filter(Boolean).join(" · ")}>
                    <div className="truncate text-gray-900 font-medium">
                      {r.name}
                      {r.brand ? (
                        <span className="text-gray-400 font-normal"> · {r.brand}</span>
                      ) : null}
                    </div>
                    {r.detail ? (
                      <div className="truncate text-[11px] text-gray-500">
                        {r.detail}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-right tabular-nums text-gray-700">
                    {r.webListPrice != null ? formatCLP(r.webListPrice) : "—"}
                  </div>
                  <div className="text-center tabular-nums text-gray-700">
                    {r.webDiscount != null && r.webDiscount > 0
                      ? `${Math.round(r.webDiscount * 100)}%`
                      : r.status === "ok"
                      ? "—"
                      : ""}
                  </div>
                  <div className="text-right tabular-nums">
                    {r.status !== "ok" || r.webTotal == null ? (
                      <span className="text-gray-300">
                        {r.status === "error" ? "no se pudo leer" : "sin precio"}
                      </span>
                    ) : (
                      <span>
                        <span className="text-gray-400 line-through">
                          {formatCLP(r.storedTotal)}
                        </span>{" "}
                        <span
                          className={`font-semibold ${
                            r.delta == null || r.delta === 0
                              ? "text-gray-900"
                              : r.delta < 0
                              ? "text-green-700"
                              : "text-red-600"
                          }`}
                        >
                          {formatCLP(r.webTotal)}
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    {r.applied ? (
                      <span className="text-[11px] text-green-700">
                        aplicado
                      </span>
                    ) : changed ? (
                      <button
                        onClick={() => onApply(r)}
                        className="text-[11px] border border-gray-300 rounded px-2 py-0.5 hover:border-gray-500"
                      >
                        aplicar
                      </button>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">
            Al aplicar se actualiza el precio lista y el descuento con lo del
            web. El Total se recalcula. Tu costo no se toca (es cotización
            aparte).
          </p>
        </>
      )}
    </div>
  );
}
