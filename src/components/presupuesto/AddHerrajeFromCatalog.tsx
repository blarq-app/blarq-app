"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCLP } from "@/lib/utils";
import { formatHerrajeName } from "@/lib/presupuesto/herrajeNombre";

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
 * modelo de herraje (un costo, proveedor DPH/HBT).
 *
 * El modal hace el POST él mismo y, al éxito, llama onAdded(line, item) para
 * que el editor meta la línea y refresque los totales de la partida. Queda
 * abierto para seguir sumando varios herrajes sin reabrirlo cada vez.
 *
 * ALTA DE UN CLIC (pendiente 138). Antes eran dos pasos: "+ elegir" marcaba la
 * fila y recién un bloque de abajo (sector + cantidad + "Agregar") creaba la
 * línea. MJ: "sería mejor apretar +agregar que elegir, la vuelta es más larga,
 * no le veo sentido". Ahora "+ agregar" crea la línea con cantidad 1 y la
 * cantidad se ajusta después en la propia línea de la partida.
 *
 * El sector salió del alta por decisión de MJ (2026-08-08): lo va a retomar
 * aparte. Las líneas nuevas entran sin sector; las que YA tienen sector se
 * siguen mostrando agrupadas igual en la partida.
 */
export default function AddHerrajeFromCatalog({
  budgetId,
  itemId,
  onAdded,
  onClose,
}: {
  budgetId: string;
  itemId: string;
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

  // Id de la fila cuyo POST está en vuelo (para deshabilitar solo ese botón) y
  // cuántas veces se agregó cada herraje en esta sesión del modal — sin esa
  // marca no hay forma de saber que el clic entró, porque la partida está más
  // abajo en la página y no se ve desde acá.
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState<Record<string, number>>({});
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

  // Crea la línea de herraje en la partida, de un clic, con cantidad 1. El back
  // devuelve la línea y el item recalculado; se los pasamos al editor por
  // onAdded. El modal queda abierto para seguir sumando.
  async function handleAdd(it: HerrajeCatalogItem) {
    if (addingId) return; // un alta a la vez: evita el doble clic accidental
    setAddingId(it.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/presupuestos/${budgetId}/muebles/items/${itemId}/herrajes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ catalogId: it.id, quantity: 1 }),
        }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "No se pudo agregar el herraje.");
        return;
      }
      const data = await res.json();
      onAdded(data.line, data.item);
      setAddedCount((prev) => ({ ...prev, [it.id]: (prev[it.id] ?? 0) + 1 }));
    } catch {
      setError("No se pudo agregar el herraje.");
    } finally {
      setAddingId(null);
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
                setError(null);
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
            const veces = addedCount[it.id] ?? 0;
            const enVuelo = addingId === it.id;
            return (
              // Fila NO clickeable entera: solo "+ agregar" crea la línea, así MJ
              // puede revisar el link del producto sin agregarlo sin querer.
              <div
                key={it.id}
                className={`grid grid-cols-[4rem_3rem_minmax(0,1.6fr)_5rem_5rem_5.5rem] items-start gap-3 px-3 py-2 border-b border-gray-100 last:border-b-0 text-xs text-left hover:bg-gray-50 ${
                  veces > 0 ? "bg-gray-50" : ""
                }`}
              >
                <div className="flex flex-col items-start gap-0.5">
                  <button
                    onClick={() => handleAdd(it)}
                    disabled={addingId !== null}
                    className="text-left font-medium text-gray-900 hover:text-gray-600 disabled:opacity-40"
                  >
                    {enVuelo ? "agregando…" : "+ agregar"}
                  </button>
                  {/* Marca de que el clic entró (la partida no se ve desde acá). */}
                  {veces > 0 && !enVuelo && (
                    <span className="text-[10px] text-gray-500 tabular-nums">
                      agregado{veces > 1 ? ` ×${veces}` : ""}
                    </span>
                  )}
                </div>
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
                  {/* Nombre homologado en estilo oración (pendiente 139): el
                      catálogo tiene tres estilos mezclados según cómo se cargó
                      cada proveedor. */}
                  <div className="font-semibold text-gray-900 leading-tight break-words">
                    {formatHerrajeName(it.name)}
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

      {error && (
        <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
          {error}
        </div>
      )}

      {/* Cerrar el modal (sigue abierto para sumar varios). */}
      <div className="mt-3 flex items-center justify-between gap-4">
        <span className="text-[10px] text-gray-400">
          Entra con cantidad 1. La cantidad se ajusta en la línea de la partida.
        </span>
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
