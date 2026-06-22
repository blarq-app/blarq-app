"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCLP } from "@/lib/utils";

// Para mostrar una imagen externa (DPH/HBT / CDN) sin que un bloqueador del
// navegador la frene, la servimos por nuestro proxy. Las subidas (data:) van
// directo.
function imgSrc(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return `/api/catalogo/img-proxy?u=${encodeURIComponent(url)}`;
  }
  return url;
}

// Item del catálogo de herrajes — shape que devuelve /api/catalogo/herrajes.
// A diferencia de los artefactos el herraje tiene UN solo costo (costNet); el
// precio cliente lo deriva el back (costo + 20%), acá no nos hace falta.
interface HerrajeCatalogItem {
  id: string;
  name: string;
  detail: string | null;
  supplier: string;
  category: string;
  subgroup: string | null;
  measure: string | null;
  finish: string | null;
  brand: string | null;
  sku: string | null;
  referenceLink: string | null;
  imageUrl: string | null;
  costNet: number;
  clientPrice: number | null;
  sortOrder: number;
}

// Línea de herraje que crea el endpoint (lo que termina viviendo en la
// cotización). El editor la usa para meterla al estado del item.
export interface MuebleHerrajeLine {
  id: string;
  itemId: string;
  catalogId: string | null;
  sector: string;
  supplier: string;
  name: string;
  measure: string | null;
  finish: string | null;
  sku: string | null;
  quantity: number;
  costNet: number;
  sortOrder: number;
}

// El item recalculado que devuelve el endpoint (con totales nuevos). El editor
// lo usa para refrescar costo/precio de la partida sin recargar todo.
interface UpdatedItem {
  id: string;
  costDistributor: number;
  utilityPercentage: number;
  clientPriceNet: number;
  clientPriceIva: number;
  [k: string]: unknown;
}

const SUPPLIER_OPTIONS = ["DPH", "HBT"] as const;
// Categorías del catálogo de herrajes (mismo set que la pantalla del catálogo).
const CATEGORY_OPTIONS = [
  "cajon",
  "corredera",
  "bisagra",
  "despensa",
  "accesorio",
] as const;
const CATEGORY_LABELS: Record<string, string> = {
  cajon: "Cajones",
  corredera: "Correderas",
  bisagra: "Bisagras",
  despensa: "Despensas",
  accesorio: "Accesorios",
};

/**
 * Modal para agregar herrajes del catálogo a una partida de herrajes de la
 * cotización de muebles. Espejo de AddArtefactoFromCatalog, pero adaptado al
 * modelo de herraje (un costo, sector en vez de room, proveedor DPH/HBT).
 *
 * El modal hace el POST él mismo y, al éxito, llama onAdded(line, item) para
 * que el editor meta la línea y refresque los totales de la partida. Queda
 * abierto para seguir sumando varios herrajes sin reabrirlo cada vez.
 */
export default function AddHerrajeFromCatalog({
  budgetId,
  itemId,
  existingSectors,
  onAdded,
  onClose,
}: {
  budgetId: string;
  itemId: string;
  existingSectors: string[];
  onAdded: (line: MuebleHerrajeLine, item: UpdatedItem) => void;
  onClose: () => void;
}) {
  const [supplier, setSupplier] = useState<(typeof SUPPLIER_OPTIONS)[number]>(
    "DPH"
  );
  const [query, setQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [items, setItems] = useState<HerrajeCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Herraje elegido + datos de la línea a crear (sector / cantidad).
  const [selected, setSelected] = useState<HerrajeCatalogItem | null>(null);
  const [sector, setSector] = useState("");
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Se trae el catálogo del proveedor activo cada vez que cambia la pestaña.
  // El filtrado por categoría/texto es local.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/catalogo/herrajes?supplier=${supplier}`
        );
        const data = await res.json();
        if (!cancelled) setItems(Array.isArray(data) ? data : []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supplier]);

  // Categorías presentes en el proveedor activo (para el filtro).
  const categoriesAvailable = useMemo(
    () => CATEGORY_OPTIONS.filter((c) => items.some((it) => it.category === c)),
    [items]
  );

  // Búsqueda: cada palabra (AND) contra nombre/detalle/marca/medida/color/sku,
  // más el filtro exacto de categoría.
  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((it) => {
      if (filterCategory && it.category !== filterCategory) return false;
      if (!words.length) return true;
      const hay = [
        it.name,
        it.detail ?? "",
        it.brand ?? "",
        it.measure ?? "",
        it.finish ?? "",
        it.sku ?? "",
        CATEGORY_LABELS[it.category] ?? it.category,
      ]
        .join(" ")
        .toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [items, query, filterCategory]);

  // Crea la línea de herraje en la partida. El back devuelve la línea y el item
  // recalculado; se los pasamos al editor por onAdded.
  async function handleAdd() {
    if (!selected) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/presupuestos/${budgetId}/muebles/items/${itemId}/herrajes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            catalogId: selected.id,
            sector: sector.trim(),
            quantity: qty,
          }),
        }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "No se pudo agregar el herraje.");
        return;
      }
      const data = await res.json();
      onAdded(data.line, data.item);
      // Dejamos el modal abierto para seguir sumando. Limpiamos la selección
      // pero conservamos el sector (en general MJ carga varios del mismo sector).
      setSelected(null);
      setQty(1);
    } catch {
      setError("No se pudo agregar el herraje.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="bg-gray-50 px-4 py-3 border-t border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-700">
          Agregar herraje del catálogo
        </h3>
        <div className="flex items-center gap-1 text-[11px]">
          {/* Pestañas de proveedor: filtran el catálogo. */}
          {SUPPLIER_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setSupplier(s);
                setFilterCategory(null);
                setSelected(null);
              }}
              className={`px-2 py-0.5 rounded ${
                supplier === s
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {s}
            </button>
          ))}
          <button
            onClick={onClose}
            className="ml-2 text-gray-400 hover:text-gray-900"
            title="Cerrar"
          >
            ×
          </button>
        </div>
      </div>

      {/* Buscador + filtro de categoría */}
      <div className="flex gap-2 mb-3">
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar corredera, bisagra, 500mm…"
          className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs outline-none focus:border-gray-500"
        />
        {categoriesAvailable.length > 0 && (
          <select
            value={filterCategory ?? ""}
            onChange={(e) => setFilterCategory(e.target.value || null)}
            className={`px-2 py-1.5 border rounded text-xs outline-none cursor-pointer focus:border-gray-500 ${
              filterCategory
                ? "border-gray-500 text-gray-900 font-medium"
                : "border-gray-300 text-gray-600"
            }`}
            title="Filtrar por categoría"
          >
            <option value="">Categoría: todas</option>
            {categoriesAvailable.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Lista de resultados del catálogo */}
      <div className="max-h-64 overflow-y-auto bg-white border border-gray-200 rounded">
        {loading && (
          <div className="px-3 py-2 text-xs text-gray-500">Buscando…</div>
        )}
        {!loading && results.length === 0 && (
          <div className="px-3 py-4 text-xs text-gray-500 text-center">
            No hay herrajes en {supplier}
            {query || filterCategory ? " con esa búsqueda o filtro" : ""}.
          </div>
        )}
        {!loading &&
          results.map((it) => {
            const isSel = selected?.id === it.id;
            return (
              // Fila NO clickeable entera: solo "+ elegir" la selecciona, así MJ
              // puede revisar el link sin elegir sin querer.
              <div
                key={it.id}
                className={`grid grid-cols-[4rem_3rem_minmax(0,1.6fr)_5rem_5rem_5.5rem] items-start gap-3 px-3 py-2 border-b border-gray-100 last:border-b-0 text-xs text-left hover:bg-gray-50 ${
                  isSel ? "bg-gray-50" : ""
                }`}
              >
                <button
                  onClick={() => {
                    setSelected(it);
                    setError(null);
                  }}
                  className={`text-left font-medium hover:text-gray-600 ${
                    isSel ? "text-gray-900" : "text-gray-900"
                  }`}
                >
                  {isSel ? "elegido" : "+ elegir"}
                </button>
                {it.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imgSrc(it.imageUrl)}
                    alt={it.name}
                    className="w-10 h-10 object-contain bg-white border border-gray-200 rounded"
                  />
                ) : (
                  <div className="w-10 h-10 bg-gray-100 rounded border border-gray-200" />
                )}
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 leading-tight break-words">
                    {it.name}
                  </div>
                  <div className="text-[10px] text-gray-500 leading-tight break-words">
                    {it.brand || CATEGORY_LABELS[it.category] || "—"}
                    {it.referenceLink && (
                      <a
                        href={it.referenceLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1.5 text-gray-500 hover:text-gray-900 underline"
                        title="Abrir el producto en la tienda"
                      >
                        ↗ ver
                      </a>
                    )}
                  </div>
                </div>
                {/* Medida en MAYÚSCULA, igual que en el catálogo. */}
                <div className="text-[10px] text-gray-700 uppercase leading-tight break-words">
                  {it.measure ?? "—"}
                </div>
                <div className="text-[10px] text-gray-600 leading-tight break-words">
                  {it.finish ?? "—"}
                </div>
                <div className="text-right tabular-nums text-gray-900 font-medium">
                  {formatCLP(it.costNet)}
                </div>
              </div>
            );
          })}
      </div>

      {/* Una vez elegido un herraje: sector + cantidad + agregar. */}
      {selected && (
        <div className="mt-3 bg-white border border-gray-200 rounded p-2.5">
          <datalist id="herraje-sectores-list">
            {existingSectors.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
                Herraje elegido
              </div>
              <div className="text-xs font-semibold text-gray-900 leading-tight break-words">
                {selected.name}
                {selected.measure ? (
                  <span className="text-gray-500 font-normal">
                    {" "}
                    · {selected.measure.toUpperCase()}
                  </span>
                ) : null}
                {selected.finish ? (
                  <span className="text-gray-500 font-normal">
                    {" "}
                    · {selected.finish.toUpperCase()}
                  </span>
                ) : null}
              </div>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
                Sector
              </label>
              <input
                type="text"
                list="herraje-sectores-list"
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                placeholder="ej. Lavaplatos"
                className="w-40 bg-white border border-gray-300 rounded px-2 py-1 text-xs outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
                Cant.
              </label>
              <input
                type="number"
                value={qty}
                onChange={(e) => setQty(parseInt(e.target.value) || 1)}
                className="w-14 bg-white border border-gray-300 rounded px-2 py-1 text-xs text-center outline-none focus:border-gray-500"
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={adding}
              className="text-xs bg-gray-900 text-white px-4 py-1.5 rounded hover:bg-gray-800 disabled:opacity-50"
            >
              {adding ? "Agregando…" : "Agregar"}
            </button>
          </div>
          {error && (
            <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Cerrar el modal (sigue abierto para sumar varios). */}
      <div className="mt-3 flex justify-end">
        <button
          onClick={onClose}
          className="text-xs text-gray-600 px-3 py-1.5 hover:text-gray-900"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}
