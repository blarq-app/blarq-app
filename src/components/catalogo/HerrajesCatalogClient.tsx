"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCLP, formatNumber } from "@/lib/utils";
import { fileToThumbnailDataUrl } from "@/lib/imageThumbnail";
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

// ── Modelo del item (Prisma HerrajeCatalog) ──────────────────────────────
// A diferencia de los artefactos, el herraje tiene UN solo costo (costNet).
// El precio a cliente se DERIVA (costNet * 1.2), salvo override en clientPrice.
export interface HerrajeItem {
  id: string;
  name: string;
  detail: string | null;
  supplier: "HBT" | "DPH";
  category: "cajon" | "corredera" | "bisagra" | "despensa";
  subgroup: string | null; // carpeta dentro de la categoría (null = "Otros")
  measure: string | null; // ej. "500mm"
  finish: string | null; // color / terminación
  brand: string | null;
  sku: string | null;
  referenceLink: string | null;
  imageUrl: string | null;
  costNet: number; // costo neto (lo que paga BLARQ)
  clientPrice: number | null; // override del precio a cliente; null = derivado
  sortOrder: number;
  lastPriceCheck: Date | string | null;
}

// Precio a cliente: el override si existe, si no el costo neto + 20%.
// Es la regla de margen de los herrajes (no hay descuento ni paleta estándar).
function clientPriceOf(it: { costNet: number; clientPrice: number | null }): number {
  return it.clientPrice ?? Math.round(it.costNet * 1.2);
}

// Src de una imagen: las externas pasan por NUESTRO proxy para que ningún
// bloqueador del navegador las frene. Las subidas (data:) y relativas van directo.
function imgSrc(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return `/api/catalogo/img-proxy?u=${encodeURIComponent(url)}`;
  }
  return url;
}

// Fila que devuelve el endpoint "Revisar precios" (costo guardado vs web ahora).
interface PriceReviewRow {
  id: string;
  name: string;
  storedCost: number;
  webCost: number | null;
  delta: number | null; // webCost - storedCost
  status: "ok" | "sin-precio" | "error";
  applied?: boolean; // marcada como aplicada en esta sesión
}

// ── Pestañas por proveedor ────────────────────────────────────────────────
const SUPPLIER_OPTIONS: ("DPH" | "HBT")[] = ["DPH", "HBT"];

// ── Categorías dentro de cada proveedor (encabezado de sección) ───────────
const CATEGORY_OPTIONS = ["cajon", "corredera", "bisagra", "despensa"] as const;
type Category = (typeof CATEGORY_OPTIONS)[number];
const CATEGORY_LABELS: Record<Category, string> = {
  cajon: "Cajones",
  corredera: "Correderas",
  bisagra: "Bisagras",
  despensa: "Despensas",
};

// ── IDs para el drag & drop ───────────────────────────────────────────────
// Reordenamos solo ítems DENTRO de una misma categoría (no movemos entre
// categorías ni reordenamos categorías: el set de 4 es fijo). Prefijo "I#".
const itemSortId = (itemId: string) => `I#${itemId}`;

// Chevron monocromático (sin librería de íconos): apunta a la derecha y rota
// 90° cuando la carpeta está abierta.
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`text-gray-400 shrink-0 transition-transform ${
        open ? "rotate-90" : ""
      }`}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

// Layout de columnas compartido entre encabezado y filas. La primera columna
// angosta es la manija de arrastre.
// 11 columnas: manija · img · nombre/marca · medida · color · sku ·
// costo · cliente · link · editar.
const GRID_COLS =
  "grid-cols-[1.25rem_3.25rem_minmax(9rem,1.6fr)_5rem_5rem_5rem_5rem_5rem_3rem_4.25rem]";

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

// Sugerencia de "nombre corto" a partir del título extraído del producto.
// Saca la marca del final y lo pasa a mayúsculas. Es solo sugerencia: MJ edita.
function sugerirNombreCorto(
  titulo?: string | null,
  marca?: string | null
): string {
  if (!titulo) return "";
  let s = titulo.trim();
  if (marca && s.toLowerCase().endsWith(marca.toLowerCase())) {
    s = s.slice(0, -marca.length).trim();
  }
  return s.toUpperCase().replace(/\s+/g, " ").trim();
}

// Carpeta dentro de una categoría (campo subgroup). Los sin carpeta caen en
// "Otros", que va al final.
interface Subgroup {
  key: string;
  name: string; // nombre de la carpeta ("" = sin carpeta)
  hasName: boolean;
  items: HerrajeItem[];
}

// Parte los ítems de una categoría en carpetas (campo subgroup). Orden:
// alfabético, con "Otros" (sin carpeta) al final.
function buildSubgroups(groupItems: HerrajeItem[]): Subgroup[] {
  const byKey = new Map<string, Subgroup>();
  for (const it of groupItems) {
    const name = (it.subgroup ?? "").trim();
    const hasName = !!name;
    const key = hasName ? name : "__sincarpeta__";
    const existing = byKey.get(key);
    if (existing) existing.items.push(it);
    else byKey.set(key, { key, name, hasName, items: [it] });
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.hasName !== b.hasName) return a.hasName ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export default function HerrajesCatalogClient({
  initialItems,
}: {
  initialItems: HerrajeItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<HerrajeItem[]>(initialItems);
  const [activeTab, setActiveTab] = useState<"DPH" | "HBT">("DPH");
  const [adding, setAdding] = useState(false);
  // Búsqueda por texto libre dentro de la pestaña: cada palabra tiene que
  // aparecer (AND) en nombre, detalle, marca, medida, color, sku o categoría.
  const [search, setSearch] = useState("");
  const addFormRef = useRef<HTMLFormElement>(null);
  // Filtros por encabezado de columna (categoría, carpeta, medida, color).
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [filterSubgroup, setFilterSubgroup] = useState<string | null>(null);
  const [filterMeasure, setFilterMeasure] = useState<string | null>(null);
  const [filterFinish, setFilterFinish] = useState<string | null>(null);
  // Si está seteado, el formulario está editando ese herraje (no creando).
  const [editingId, setEditingId] = useState<string | null>(null);
  // Carpetas que MJ abrió/cerró a mano (true = abierta).
  const [openSubgroups, setOpenSubgroups] = useState<Record<string, boolean>>(
    {}
  );
  const [newItem, setNewItem] = useState({
    name: "",
    detail: "",
    supplier: "DPH" as "DPH" | "HBT",
    category: "cajon" as Category,
    subgroup: "",
    measure: "",
    finish: "",
    brand: "",
    sku: "",
    referenceLink: "",
    imageUrl: "",
    costNet: 0,
    clientPrice: 0,
  });
  const [extractingForNew, setExtractingForNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── "Revisar precios" ─────────────────────────────────────────────────
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewRows, setReviewRows] = useState<PriceReviewRow[]>([]);
  const [reviewResumen, setReviewResumen] = useState<{
    ok: number;
    changed: number;
    sinPrecio: number;
    error: number;
  } | null>(null);

  // ── Conteo por pestaña (universo completo, sin filtros) ────────────────
  const countsByTab = useMemo(() => {
    const c: Record<string, number> = { DPH: 0, HBT: 0 };
    for (const it of items) {
      if (c[it.supplier] !== undefined) c[it.supplier]++;
    }
    return c;
  }, [items]);

  // ── Items de la pestaña activa, ordenados por sortOrder ────────────────
  // Base "real" del tab (sin filtros): el orden para arrastrar.
  const tabItems = useMemo(() => {
    return items
      .filter((it) => it.supplier === activeTab)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }, [items, activeTab]);

  // Con búsqueda o cualquier filtro activo no se puede arrastrar (estaríamos
  // reordenando sobre una vista parcial).
  const isFiltering =
    !!search.trim() ||
    !!filterCategory ||
    !!filterSubgroup ||
    !!filterMeasure ||
    !!filterFinish;

  // Valores disponibles en la pestaña activa (para los desplegables de filtro).
  const categoriesInTab = useMemo(
    () =>
      CATEGORY_OPTIONS.filter((cat) =>
        tabItems.some((it) => it.category === cat)
      ),
    [tabItems]
  );
  const subgroupsInTab = useMemo(
    () =>
      Array.from(
        new Set(tabItems.map((it) => (it.subgroup ?? "").trim()).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b)),
    [tabItems]
  );
  const measuresInTab = useMemo(
    () =>
      Array.from(
        new Set(tabItems.map((it) => it.measure).filter(Boolean))
      ).sort((a, b) => (a as string).localeCompare(b as string)) as string[],
    [tabItems]
  );
  const finishesInTab = useMemo(
    () =>
      Array.from(
        new Set(tabItems.map((it) => it.finish).filter(Boolean))
      ).sort((a, b) => (a as string).localeCompare(b as string)) as string[],
    [tabItems]
  );

  // ── Lista visible: filtros + búsqueda sobre tabItems ───────────────────
  const visible = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return tabItems.filter((it) => {
      if (filterCategory && it.category !== filterCategory) return false;
      if (filterSubgroup && (it.subgroup ?? "").trim() !== filterSubgroup)
        return false;
      if (filterMeasure && it.measure !== filterMeasure) return false;
      if (filterFinish && it.finish !== filterFinish) return false;
      if (words.length) {
        const hay = [
          it.name,
          it.detail,
          it.brand,
          it.measure,
          it.finish,
          it.sku,
          CATEGORY_LABELS[it.category],
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
  }, [tabItems, filterCategory, filterSubgroup, filterMeasure, filterFinish, search]);

  // ── Drag & drop ───────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Persiste el orden de los ítems (0..n). Solo guarda; el estado optimista
  // lo actualiza quien llama.
  async function persistItemOrder(ordered: HerrajeItem[]) {
    try {
      await fetch("/api/catalogo/herrajes/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: ordered.map((it, i) => ({ id: it.id, sortOrder: i })),
        }),
      });
    } catch {
      alert("Error al guardar el orden");
      router.refresh();
    }
  }

  // Reordenar ítems DENTRO de una misma carpeta (misma categoría y carpeta).
  function reorderItemWithinSubgroup(moved: HerrajeItem, overItemId: string) {
    const cat = moved.category;
    const sub = (moved.subgroup ?? "").trim();
    const groupItems = tabItems.filter(
      (it) => it.category === cat && (it.subgroup ?? "").trim() === sub
    );
    const oldIdx = groupItems.findIndex((it) => it.id === moved.id);
    const newIdx = groupItems.findIndex((it) => it.id === overItemId);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(groupItems, oldIdx, newIdx);
    const orderMap = new Map(reordered.map((it, i) => [it.id, i]));
    setItems((prev) =>
      prev.map((it) =>
        orderMap.has(it.id) ? { ...it, sortOrder: orderMap.get(it.id)! } : it
      )
    );
    persistItemOrder(reordered);
  }

  // Reordenamos solo entre ítems de la MISMA carpeta. Soltar sobre otra carpeta
  // no mueve (la categoría/carpeta de un herraje se cambia por el botón Editar).
  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const a = String(active.id);
    const o = String(over.id);
    if (a === o) return;
    if (a[0] !== "I" || o[0] !== "I") return;
    const moved = items.find((it) => it.id === a.slice(2));
    const target = items.find((it) => it.id === o.slice(2));
    if (!moved || !target) return;
    const sameGroup =
      moved.category === target.category &&
      (moved.subgroup ?? "").trim() === (target.subgroup ?? "").trim();
    if (sameGroup) reorderItemWithinSubgroup(moved, target.id);
  }

  // ── Mutaciones ────────────────────────────────────────────────────────
  async function persistItem(item: HerrajeItem) {
    try {
      await fetch(`/api/catalogo/herrajes/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
    } catch {
      /* silent */
    }
  }

  function updateItem(id: string, patch: Partial<HerrajeItem>) {
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
    if (!confirm("¿Borrar este herraje del catálogo?")) return;
    try {
      await fetch(`/api/catalogo/herrajes/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((it) => it.id !== id));
    } catch {
      alert("Error al borrar");
    }
  }

  // Estado en blanco del formulario (alta o cierre), conservando la pestaña.
  function blankForm() {
    return {
      name: "",
      detail: "",
      supplier: activeTab,
      category: "cajon" as Category,
      subgroup: "",
      measure: "",
      finish: "",
      brand: "",
      sku: "",
      referenceLink: "",
      imageUrl: "",
      costNet: 0,
      clientPrice: 0,
    };
  }

  async function handleAddNew() {
    if (!newItem.name.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setError(null);
    try {
      const res = await fetch("/api/catalogo/herrajes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newItem.name,
          supplier: newItem.supplier,
          category: newItem.category,
          subgroup: newItem.subgroup || undefined,
          detail: newItem.detail || undefined,
          measure: newItem.measure || undefined,
          finish: newItem.finish || undefined,
          brand: newItem.brand || undefined,
          sku: newItem.sku || undefined,
          referenceLink: newItem.referenceLink || undefined,
          imageUrl: newItem.imageUrl || undefined,
          costNet: newItem.costNet,
          // Solo mandamos override si MJ puso algo distinto de 0.
          clientPrice: newItem.clientPrice || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Error");
      }
      const created = await res.json();
      setItems((prev) => [...prev, created]);
      setActiveTab(created.supplier);
      setNewItem(blankForm());
      setAdding(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    }
  }

  // Cierra el formulario (alta o edición) y lo deja en blanco.
  function closeForm() {
    setAdding(false);
    setEditingId(null);
    setError(null);
    setNewItem(blankForm());
  }

  // Abre el alta con la categoría y la pestaña ya puestas — desde el botón
  // "+ agregar" de cada sección. Hace scroll al formulario (que está arriba).
  function openAddForCategory(category: Category) {
    closeForm();
    setNewItem({ ...blankForm(), supplier: activeTab, category });
    setAdding(true);
    setTimeout(
      () =>
        addFormRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      50
    );
  }

  // Abre el formulario completo cargado con los datos de un herraje.
  function openEdit(item: HerrajeItem) {
    setAdding(false);
    setError(null);
    setEditingId(item.id);
    setNewItem({
      name: item.name,
      detail: item.detail ?? "",
      supplier: item.supplier,
      category: item.category,
      subgroup: item.subgroup ?? "",
      measure: item.measure ?? "",
      finish: item.finish ?? "",
      brand: item.brand ?? "",
      sku: item.sku ?? "",
      referenceLink: item.referenceLink ?? "",
      imageUrl: item.imageUrl ?? "",
      costNet: item.costNet ?? 0,
      clientPrice: item.clientPrice ?? 0,
    });
  }

  // Guarda los cambios del herraje en edición (PUT).
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
      supplier: newItem.supplier,
      category: newItem.category,
      subgroup: newItem.subgroup || null,
      measure: newItem.measure || null,
      finish: newItem.finish || null,
      brand: newItem.brand || null,
      sku: newItem.sku || null,
      referenceLink: newItem.referenceLink || null,
      imageUrl: newItem.imageUrl || null,
      costNet: newItem.costNet,
      // 0 en el form = sin override → derivado.
      clientPrice: newItem.clientPrice || null,
    };
    try {
      const res = await fetch(`/api/catalogo/herrajes/${editingId}`, {
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
      setActiveTab(newItem.supplier);
      closeForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    }
  }

  // Extraer datos al pegar URL en el formulario de "nuevo". Reusa el endpoint
  // genérico de artefactos: devuelve {name, brand, imageUrl, listPrice}. El
  // listPrice extraído lo usamos como costo de partida (después MJ lo ajusta).
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
        // Sugerir el nombre corto SOLO si está vacío (no pisa lo de MJ).
        name: prev.name.trim()
          ? prev.name
          : sugerirNombreCorto(data.name, data.brand),
        imageUrl: data.imageUrl ?? prev.imageUrl,
        detail: data.name ?? prev.detail,
        brand: data.brand ?? prev.brand,
        // El precio extraído lo cargamos como costo si todavía no había uno.
        costNet:
          data.listPrice != null && !prev.costNet ? data.listPrice : prev.costNet,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setExtractingForNew(false);
    }
  }

  // ── Revisar precios: trae el costo web de hoy y compara ────────────────
  async function handleRevisarPrecios() {
    setReviewOpen(true);
    setReviewLoading(true);
    setReviewRows([]);
    setReviewResumen(null);
    try {
      const res = await fetch("/api/catalogo/herrajes/revisar-precios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      setReviewRows(data.rows ?? []);
      setReviewResumen(data.summary ?? null);
    } catch {
      setReviewRows([]);
      setReviewResumen(null);
      alert("No se pudieron revisar los precios.");
    } finally {
      setReviewLoading(false);
    }
  }

  // Aplica el costo web a un herraje: actualiza costNet (el precio a cliente se
  // recalcula solo, salvo override).
  function applyReviewRow(row: PriceReviewRow) {
    if (row.webCost == null) return;
    updateItem(row.id, { costNet: row.webCost });
    setReviewRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, applied: true } : r))
    );
  }

  function applyAllChanged() {
    for (const row of reviewRows) {
      if (
        row.status === "ok" &&
        row.delta != null &&
        row.delta !== 0 &&
        !row.applied
      ) {
        applyReviewRow(row);
      }
    }
  }

  // ── Agrupado por categoría → carpeta ───────────────────────────────────
  // Las 4 categorías van en orden fijo. Vacías solo se ocultan si estás
  // filtrando (ahí solo importan las que tienen resultados).
  const groups: { category: Category; items: HerrajeItem[] }[] = (() => {
    const byCat = new Map<Category, HerrajeItem[]>();
    for (const it of visible) {
      const arr = byCat.get(it.category);
      if (arr) arr.push(it);
      else byCat.set(it.category, [it]);
    }
    const result: { category: Category; items: HerrajeItem[] }[] = [];
    for (const cat of CATEGORY_OPTIONS) {
      const its = byCat.get(cat) ?? [];
      if (its.length === 0 && (isFiltering || !categoriesInTab.includes(cat)))
        continue;
      result.push({ category: cat, items: its });
    }
    return result;
  })();

  // Default de carpeta: abierta. Un toggle manual pisa.
  function isSubgroupCollapsed(key: string): boolean {
    const manual = openSubgroups[key];
    if (manual !== undefined) return !manual;
    return false;
  }
  function toggleSubgroup(key: string, currentlyCollapsed: boolean) {
    setOpenSubgroups((prev) => ({ ...prev, [key]: currentlyCollapsed }));
  }

  // Filas de una carpeta (o de una categoría plana). Comparten el DndContext de
  // afuera; los ids llevan prefijo "I#".
  function renderItemRows(rowItems: HerrajeItem[]) {
    return (
      <SortableContext
        items={rowItems.map((it) => itemSortId(it.id))}
        strategy={verticalListSortingStrategy}
      >
        {rowItems.map((item) => (
          <HerrajeItemRow
            key={item.id}
            sortId={itemSortId(item.id)}
            item={item}
            canReorder={!isFiltering}
            onUpdate={(patch) => updateItem(item.id, patch)}
            onEdit={() => openEdit(item)}
            onDelete={() => deleteItem(item.id)}
          />
        ))}
      </SortableContext>
    );
  }

  return (
    <div>
      {/* Sugerencias para Medida / Color (filas y formulario). */}
      <datalist id="medidas-list">
        {measuresInTab.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <datalist id="colores-list">
        {finishesInTab.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <datalist id="carpetas-list">
        {subgroupsInTab.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {/* Pestañas por proveedor */}
      <div className="flex items-center gap-2 mb-4">
        {SUPPLIER_OPTIONS.map((s) => {
          const active = activeTab === s;
          return (
            <button
              key={s}
              onClick={() => {
                setActiveTab(s);
                // Categorías/medidas/colores difieren por pestaña: limpiamos
                // filtros para no esconder todo con un filtro de otra pestaña.
                setFilterCategory(null);
                setFilterSubgroup(null);
                setFilterMeasure(null);
                setFilterFinish(null);
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                active
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
              }`}
            >
              {s}
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

      {/* Toolbar: buscador + revisar + nuevo. */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar… (ej. corredera, 500mm)"
            className="w-64 px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white outline-none focus:border-gray-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-900 text-sm leading-none"
              title="Limpiar búsqueda"
            >
              ×
            </button>
          )}
        </div>
        <button
          onClick={handleRevisarPrecios}
          disabled={reviewLoading}
          className="ml-auto text-sm border border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium hover:border-gray-500 disabled:opacity-50"
          title="Trae el costo web de hoy para los herrajes con link y te muestra los cambios"
        >
          {reviewLoading ? "Revisando…" : "Revisar precios"}
        </button>
        <button
          onClick={() => {
            if (adding) {
              closeForm();
              return;
            }
            closeForm();
            setNewItem({ ...blankForm(), supplier: activeTab });
            setAdding(true);
          }}
          className="text-sm bg-gray-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-800"
        >
          {adding ? "Cancelar" : "+ Nuevo herraje"}
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
          ref={addFormRef}
          onSubmit={(e) => {
            e.preventDefault();
            if (editingId) handleSaveEdit();
            else handleAddNew();
          }}
          className="bg-white rounded-xl border border-gray-200 p-5 mb-4"
        >
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
            {editingId ? "Editar herraje" : "Nuevo herraje"}
          </h2>

          {/* Atajo: link del producto + extraer */}
          <div className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-3">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Atajo — pegá link del producto y extraé lo que se pueda
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={newItem.referenceLink}
                onChange={(e) =>
                  setNewItem({ ...newItem, referenceLink: e.target.value })
                }
                placeholder="https://…"
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
              Trae imagen, nombre, marca y precio (queda como costo). Después
              podés ajustar.
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
                onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                placeholder="CORREDERA OCULTA"
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
                placeholder="Corredera oculta cierre suave"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Proveedor *
              </label>
              <select
                value={newItem.supplier}
                onChange={(e) =>
                  setNewItem({
                    ...newItem,
                    supplier: e.target.value as "DPH" | "HBT",
                  })
                }
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500 bg-white"
              >
                {SUPPLIER_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Categoría *
              </label>
              <select
                value={newItem.category}
                onChange={(e) =>
                  setNewItem({
                    ...newItem,
                    category: e.target.value as Category,
                  })
                }
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500 bg-white"
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Carpeta (para agrupar)
              </label>
              <input
                type="text"
                list="carpetas-list"
                value={newItem.subgroup}
                onChange={(e) =>
                  setNewItem({ ...newItem, subgroup: e.target.value })
                }
                placeholder="Otros"
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
                placeholder="Blum, Häfele…"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Medida
              </label>
              <input
                type="text"
                list="medidas-list"
                value={newItem.measure}
                onChange={(e) =>
                  setNewItem({ ...newItem, measure: e.target.value })
                }
                placeholder="500mm"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Color / terminación
              </label>
              <input
                type="text"
                list="colores-list"
                value={newItem.finish}
                onChange={(e) =>
                  setNewItem({ ...newItem, finish: e.target.value })
                }
                placeholder="Cromo, Negro…"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                SKU
              </label>
              <input
                type="text"
                value={newItem.sku}
                onChange={(e) => setNewItem({ ...newItem, sku: e.target.value })}
                placeholder="código del proveedor"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Costo neto
              </label>
              <ThousandsInput
                value={newItem.costNet}
                onChange={(v) => setNewItem({ ...newItem, costNet: v })}
                placeholder="0"
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm tabular-nums text-right outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Precio cliente (opcional)
              </label>
              <ThousandsInput
                value={newItem.clientPrice}
                onChange={(v) => setNewItem({ ...newItem, clientPrice: v })}
                placeholder={
                  newItem.costNet
                    ? `auto: ${formatNumber(Math.round(newItem.costNet * 1.2))}`
                    : "auto: costo + 20%"
                }
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
                  value={
                    newItem.imageUrl.startsWith("data:") ? "" : newItem.imageUrl
                  }
                  onChange={(e) =>
                    setNewItem({ ...newItem, imageUrl: e.target.value })
                  }
                  placeholder="…o pegá https://…/imagen.jpg"
                  className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-gray-500"
                />
              </div>
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
          <div>
            Nombre / marca
            {/* Filtro por carpeta (subgroup) en el encabezado de Nombre. */}
            <select
              value={filterSubgroup ?? ""}
              onChange={(e) => setFilterSubgroup(e.target.value || null)}
              className="mt-0.5 w-full bg-white border border-gray-200 rounded text-[10px] font-normal normal-case tracking-normal text-gray-600 px-0.5 py-0.5 outline-none cursor-pointer focus:border-gray-400"
              title="Filtrar por carpeta"
            >
              <option value="">todas las carpetas</option>
              {subgroupsInTab.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          {/* Medida — encabezado con desplegable de filtro. */}
          <div className="leading-tight">
            Medida
            <select
              value={filterMeasure ?? ""}
              onChange={(e) => setFilterMeasure(e.target.value || null)}
              className="mt-0.5 w-full bg-white border border-gray-200 rounded text-[10px] font-normal normal-case tracking-normal text-gray-600 px-0.5 py-0.5 outline-none cursor-pointer focus:border-gray-400"
              title="Filtrar por medida"
            >
              <option value="">todas</option>
              {measuresInTab.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          {/* Color — encabezado con desplegable de filtro. */}
          <div className="leading-tight">
            Color
            <select
              value={filterFinish ?? ""}
              onChange={(e) => setFilterFinish(e.target.value || null)}
              className="mt-0.5 w-full bg-white border border-gray-200 rounded text-[10px] font-normal normal-case tracking-normal text-gray-600 px-0.5 py-0.5 outline-none cursor-pointer focus:border-gray-400"
              title="Filtrar por color"
            >
              <option value="">todos</option>
              {finishesInTab.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div>SKU</div>
          <div className="text-right">Costo</div>
          <div className="text-right" title="Costo + 20% (salvo override)">
            Cliente
          </div>
          <div className="text-center">Link</div>
          <div></div>
        </div>

        {!isFiltering && tabItems.length > 1 && (
          <div className="px-4 py-1.5 bg-white border-b border-gray-100 text-[11px] text-gray-400">
            Los herrajes quedan agrupados por categoría y, dentro de cada una, en
            carpetas (clic en la carpeta para abrir/cerrar). Arrastrá desde la
            manija (⋮⋮) para reordenar dentro de una carpeta. Para cambiar de
            categoría, carpeta o pestaña, usá el botón Editar. El precio a
            cliente se calcula solo (costo + 20%) salvo que pongas uno fijo en
            Editar.
          </div>
        )}

        {visible.length === 0 && groups.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            {tabItems.length === 0
              ? "Todavía no hay herrajes en esta pestaña. Apretá '+ Nuevo herraje' para empezar."
              : "No hay resultados con esos filtros."}
          </div>
        ) : (
          <DndContext
            id="herrajes-dnd"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            {groups.map((g) => (
              <Fragment key={g.category}>
                {/* Encabezado de categoría (sección fija, no arrastrable). */}
                <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-3">
                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    {CATEGORY_LABELS[g.category]}
                    <span className="ml-1.5 text-gray-400 tabular-nums">
                      · {g.items.length}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => openAddForCategory(g.category)}
                    className="text-[10px] uppercase tracking-wider text-gray-500 hover:text-gray-900"
                    title={`Agregar un herraje en ${CATEGORY_LABELS[g.category]}`}
                  >
                    + agregar
                  </button>
                </div>
                {(() => {
                  const subs = buildSubgroups(g.items);
                  // Una sola carpeta: se muestra plano, sin sub-encabezado.
                  if (subs.length <= 1) return renderItemRows(g.items);
                  return subs.map((sg) => {
                    const key = `${g.category}::${sg.key}`;
                    const collapsed = isSubgroupCollapsed(key);
                    return (
                      <Fragment key={key}>
                        {/* Sub-encabezado de carpeta (chico y gris). */}
                        <button
                          type="button"
                          onClick={() => toggleSubgroup(key, collapsed)}
                          className="w-full flex items-center gap-1.5 pl-6 pr-4 py-1 bg-white border-b border-gray-100 hover:bg-gray-50 text-left"
                        >
                          <Chevron open={!collapsed} />
                          <span className="text-[10px] font-medium text-gray-500 tracking-wide uppercase">
                            {sg.hasName ? sg.name : "Otros"}
                          </span>
                          <span className="text-[10px] text-gray-400 tabular-nums">
                            · {sg.items.length}
                          </span>
                        </button>
                        {!collapsed && renderItemRows(sg.items)}
                      </Fragment>
                    );
                  });
                })()}
              </Fragment>
            ))}
          </DndContext>
        )}
      </div>
    </div>
  );
}

// ─── Componente: fila editable + arrastrable ────────────────────────────
function HerrajeItemRow({
  item,
  sortId,
  canReorder,
  onUpdate,
  onEdit,
  onDelete,
}: {
  item: HerrajeItem;
  sortId: string;
  canReorder: boolean;
  onUpdate: (patch: Partial<HerrajeItem>) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const sortable = useSortable({ id: sortId, disabled: !canReorder });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // URL de imagen que no cargó (rota): mostramos el "+" para subir otra en vez
  // del ícono roto.
  const [failedImg, setFailedImg] = useState<string | null>(null);

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

  // El precio a cliente es derivado (read-only): costo +20% salvo override.
  const overridden = item.clientPrice != null;
  const client = clientPriceOf(item);

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
            title="Sacá la búsqueda y los filtros para poder reordenar"
          >
            ⋮⋮
          </span>
        )}
      </div>

      {/* Foto */}
      <div className="flex justify-center">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            handlePhotoFile(e.target.files?.[0]);
            e.target.value = "";
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

      {/* Nombre + marca (la caja crece a su contenido, no trunca). */}
      <div className="min-w-0">
        <textarea
          rows={1}
          value={item.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          className="w-full bg-transparent border-0 p-0 font-semibold text-gray-900 text-[11px] leading-tight resize-none [field-sizing:content] outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1.5 focus:py-0.5"
        />
        {/* Marca debajo, gris y discreta. */}
        <input
          type="text"
          value={item.brand ?? ""}
          placeholder="marca"
          onChange={(e) => onUpdate({ brand: e.target.value || null })}
          className="w-full bg-transparent border-0 p-0 text-gray-500 text-[10px] uppercase outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5"
        />
      </div>

      {/* Medida (editable). En MAYÚSCULA, 2 líneas si hace falta. */}
      <div className="min-w-0">
        <textarea
          rows={1}
          value={item.measure ?? ""}
          placeholder="—"
          onChange={(e) => onUpdate({ measure: e.target.value || null })}
          className="w-full bg-transparent border-0 p-0 text-gray-700 text-[11px] font-medium uppercase leading-tight break-words resize-none [field-sizing:content] outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5"
        />
      </div>

      {/* Color / terminación (editable). En MAYÚSCULA. */}
      <div className="min-w-0">
        <textarea
          rows={1}
          value={item.finish ?? ""}
          placeholder="—"
          onChange={(e) => onUpdate({ finish: e.target.value || null })}
          className="w-full bg-transparent border-0 p-0 text-gray-600 text-[11px] uppercase leading-tight break-words resize-none [field-sizing:content] outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5"
        />
      </div>

      {/* SKU (chico gris). */}
      <div className="min-w-0">
        <input
          type="text"
          value={item.sku ?? ""}
          placeholder="—"
          onChange={(e) => onUpdate({ sku: e.target.value || null })}
          className="w-full bg-transparent border-0 p-0 text-gray-400 text-[10px] outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5"
        />
      </div>

      {/* Costo (editable inline = costNet). */}
      <div>
        <ThousandsInput
          value={item.costNet}
          onChange={(v) => onUpdate({ costNet: v })}
          placeholder="0"
          className="w-full bg-transparent border-0 p-0 text-right tabular-nums text-gray-700 outline-none focus:bg-white focus:border focus:border-gray-300 focus:rounded focus:px-1 focus:py-0.5"
        />
      </div>

      {/* Cliente (derivado, read-only). Gris cuando es automático; con marca
          discreta cuando hay precio fijo (override). */}
      <div
        className="text-right tabular-nums text-gray-500"
        title={
          overridden
            ? "Precio fijo (editalo en el botón Editar)"
            : "Costo + 20% (automático)"
        }
      >
        {item.costNet === 0 && !overridden ? (
          <span className="text-gray-300">—</span>
        ) : (
          <span className={overridden ? "text-gray-700 font-medium" : ""}>
            {formatCLP(client)}
            {overridden && (
              <span className="ml-0.5 text-[9px] text-gray-400 align-top">
                fijo
              </span>
            )}
          </span>
        )}
      </div>

      {/* Link */}
      <div className="flex justify-center">
        {item.referenceLink ? (
          <a
            href={item.referenceLink}
            target="_blank"
            rel="noreferrer"
            className="text-gray-400 hover:text-gray-900 text-sm leading-none"
            title={item.referenceLink}
          >
            ↗
          </a>
        ) : (
          <span className="text-gray-200 select-none">—</span>
        )}
      </div>

      {/* Acciones */}
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

// ─── Panel "Revisar precios": costo guardado vs web ahora ───────────────
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
  resumen: { ok: number; changed: number; sinPrecio: number; error: number } | null;
  onApply: (row: PriceReviewRow) => void;
  onApplyAll: () => void;
  onClose: () => void;
}) {
  const COLS = "grid-cols-[minmax(0,1fr)_8rem_5rem]";
  // Por default mostramos SOLO lo que cambió. El resto queda detrás de "ver
  // todos".
  const [showAll, setShowAll] = useState(false);
  const changedRows = rows.filter(
    (r) => r.status === "ok" && r.delta != null && r.delta !== 0
  );
  const displayRows = showAll ? rows : changedRows;
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
          Trayendo costos de la web…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500 py-6 text-center">
          No hay herrajes con link para revisar.
        </p>
      ) : (
        <>
          {resumen && (
            <div className="flex items-center justify-between gap-3 mb-3 text-xs text-gray-600">
              <span>
                {resumen.ok} leídos ·{" "}
                <span className="text-gray-900 font-medium">
                  {resumen.changed} cambiaron
                </span>
                {resumen.sinPrecio > 0
                  ? ` · ${resumen.sinPrecio} sin precio`
                  : ""}
                {resumen.error > 0
                  ? ` · ${resumen.error} no se pudieron leer`
                  : ""}
              </span>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={() => setShowAll((v) => !v)}
                  className="text-gray-500 underline hover:text-gray-900"
                >
                  {showAll
                    ? "Ver solo los que cambiaron"
                    : `Ver todos (${rows.length})`}
                </button>
                {resumen.changed > 0 && (
                  <button
                    onClick={onApplyAll}
                    className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded hover:bg-gray-800"
                  >
                    Aplicar todos los cambios
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div
              className={`grid ${COLS} gap-2 px-3 py-2 bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500 font-semibold`}
            >
              <div>Herraje</div>
              <div className="text-right">Costo (antes → web)</div>
              <div></div>
            </div>
            {displayRows.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-gray-500">
                Ningún costo cambió.{" "}
                <button
                  onClick={() => setShowAll(true)}
                  className="text-gray-600 underline hover:text-gray-900"
                >
                  Ver todos ({rows.length})
                </button>
              </div>
            ) : (
              displayRows.map((r) => {
                const changed =
                  r.status === "ok" && r.delta != null && r.delta !== 0;
                return (
                  <div
                    key={r.id}
                    className={`grid ${COLS} gap-2 px-3 py-2 border-t border-gray-100 text-xs items-center`}
                  >
                    <div className="min-w-0" title={r.name}>
                      <div className="truncate text-gray-900 font-medium">
                        {r.name}
                      </div>
                    </div>
                    <div className="text-right tabular-nums">
                      {r.status !== "ok" || r.webCost == null ? (
                        <span className="text-gray-300">
                          {r.status === "error" ? "no se pudo leer" : "sin precio"}
                        </span>
                      ) : (
                        <span>
                          <span className="text-gray-400 line-through">
                            {formatCLP(r.storedCost)}
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
                            {formatCLP(r.webCost)}
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
              })
            )}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">
            Al aplicar se actualiza el costo con lo del web. El precio a cliente
            se recalcula solo (costo + 20%), salvo que el herraje tenga un precio
            fijo.
          </p>
        </>
      )}
    </div>
  );
}
