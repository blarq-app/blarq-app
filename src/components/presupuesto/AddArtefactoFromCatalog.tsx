"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCLP } from "@/lib/utils";
import { fileToThumbnailDataUrl } from "@/lib/imageThumbnail";

// Para mostrar una imagen externa (mk.cl / CDN) sin que un bloqueador del
// navegador la frene, la servimos por nuestro proxy. Las subidas (data:) van
// directo.
function imgSrc(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return `/api/catalogo/img-proxy?u=${encodeURIComponent(url)}`;
  }
  return url;
}

// Item del catálogo BLARQ — shape que devuelve /api/catalogo/artefactos
interface CatalogItem {
  id: string;
  name: string;
  detail: string | null;
  brand: string | null;
  subcategory: string;
  tag: string | null;
  line: string | null; // línea comercial (Asis, Urban, Stellar…)
  finish: string | null; // color/terminación (Cromo, Brushed, Gun Grey…)
  supplier: string | null;
  referenceLink: string | null;
  imageUrl: string | null;
  listPrice: number;
  discountPercent: number | null;
  isStandard: boolean;
}

// Payload que se devuelve al editor cuando MJ elige "agregar" — el editor
// usa estos campos para crear el ArtefactoItem en BD.
export interface ArtefactoFromCatalog {
  catalogId: string | null;
  name: string;
  detail: string | null;
  brand: string | null;
  quantity: number;
  listPrice: number;
  discountPercent: number | null;
  referenceLink: string | null;
  imageUrl: string | null;
  // Solo para alta manual ("Crear nuevo"): si MJ eligió desplegar el artefacto
  // al catálogo (default = false, solo en este proyecto). Línea/color viajan
  // para que la entrada del catálogo nazca ya agrupable (el ítem de la
  // cotización no los guarda — los deriva del nombre).
  promoteToCatalog?: boolean;
  line?: string | null;
  finish?: string | null;
}

/**
 * UI para agregar un artefacto a un room del presupuesto.
 *
 * Tiene dos modos:
 *   1. "Buscar en catálogo" (default) — busca en el catálogo BLARQ.
 *      Al elegir uno, autocompleta todos los campos del item y lo agrega.
 *   2. "Crear nuevo" — mismo formulario cómodo que el catálogo: pegar el link
 *      del producto y "Extraer" (foto, nombre, marca, precio), subir foto, y
 *      elegir si el artefacto va SOLO en este proyecto (default) o se DESPLIEGA
 *      al catálogo (queda buscable para la próxima vez).
 */
export default function AddArtefactoFromCatalog({
  roomLabel,
  defaultSubcategory,
  onAdd,
  onCancel,
}: {
  roomLabel: string;
  defaultSubcategory: string;
  onAdd: (payload: ArtefactoFromCatalog) => Promise<void>;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"search" | "new">("search");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  // Filtros por línea/color — sirven para armar un baño completo de una
  // misma línea (ej: toda la grifería Asis Cromo) sin tipear cada vez.
  const [filterLine, setFilterLine] = useState<string | null>(null);
  const [filterFinish, setFilterFinish] = useState<string | null>(null);

  // Form manual (modo "new")
  const [manualName, setManualName] = useState("");
  const [manualDetail, setManualDetail] = useState("");
  const [manualBrand, setManualBrand] = useState("");
  const [manualListPrice, setManualListPrice] = useState(0);
  const [manualDiscount, setManualDiscount] = useState(0);
  // Comodidades del catálogo: link + extraer, foto, y línea/color (solo se usan
  // cuando se despliega al catálogo).
  const [manualLink, setManualLink] = useState("");
  const [manualImageUrl, setManualImageUrl] = useState("");
  const [manualLine, setManualLine] = useState("");
  const [manualFinish, setManualFinish] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  // Elección: false = solo en este proyecto (default); true = desplegar al
  // catálogo (queda buscable para la próxima vez).
  const [promoteToCatalog, setPromoteToCatalog] = useState(false);

  // Se trae UNA vez todo el catálogo de la pestaña (son ~100 items, liviano)
  // y el filtrado pasa a ser local. Así los desplegables de línea/color
  // muestran siempre las opciones completas de la pestaña, aunque haya algo
  // tipeado en la búsqueda (igual que en la página del catálogo). Se trae en
  // ambos modos: el modo "Crear nuevo" usa las mismas líneas/colores como
  // sugerencias al desplegar al catálogo.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("subcategory", defaultSubcategory);
        const res = await fetch(
          `/api/catalogo/artefactos?${params.toString()}`
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
  }, [defaultSubcategory]);

  // Líneas y colores disponibles en la pestaña (para los desplegables).
  const linesAvailable = useMemo(
    () =>
      Array.from(new Set(items.map((it) => it.line).filter(Boolean))).sort() as string[],
    [items]
  );
  const finishesAvailable = useMemo(
    () =>
      Array.from(new Set(items.map((it) => it.finish).filter(Boolean))).sort() as string[],
    [items]
  );

  // Mismo criterio de búsqueda que la página del catálogo: texto contra
  // nombre/detalle/marca/proveedor/línea/color, más los filtros exactos.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (filterLine && it.line !== filterLine) return false;
      if (filterFinish && it.finish !== filterFinish) return false;
      if (!q) return true;
      return [
        it.name,
        it.detail ?? "",
        it.brand ?? "",
        it.supplier ?? "",
        it.line ?? "",
        it.finish ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [items, query, filterLine, filterFinish]);

  async function handleAddFromCatalog(item: CatalogItem, q: number) {
    await onAdd({
      catalogId: item.id,
      name: item.name,
      detail: item.detail,
      brand: item.brand,
      quantity: q,
      listPrice: item.listPrice,
      discountPercent: item.discountPercent,
      referenceLink: item.referenceLink,
      imageUrl: item.imageUrl,
    });
  }

  // Pegar el link del producto y traer foto/nombre/marca/precio — misma
  // comodidad que el alta del catálogo. Reusa el endpoint del catálogo.
  async function handleExtractManual() {
    if (!manualLink.trim()) {
      setManualError("Pegá un link primero.");
      return;
    }
    setExtracting(true);
    setManualError(null);
    try {
      const res = await fetch(
        `/api/catalogo/artefactos/extract?url=${encodeURIComponent(
          manualLink.trim()
        )}`
      );
      const data = await res.json();
      if (!res.ok) {
        setManualError(data.error || "No se pudo extraer");
        return;
      }
      // No pisa lo que MJ ya escribió: solo rellena lo vacío.
      if (!manualName.trim() && data.name)
        setManualName(String(data.name).toUpperCase().replace(/\s+/g, " ").trim());
      if (!manualDetail.trim() && data.name) setManualDetail(data.name);
      if (!manualBrand.trim() && data.brand) setManualBrand(data.brand);
      if (!manualListPrice && data.listPrice) setManualListPrice(data.listPrice);
      // El descuento vigente en la tienda (arreglo 2026-07-31): antes el
      // producto en oferta entraba con el precio rebajado como lista y 0% de
      // descuento. Viene null en tiendas que no lo publican.
      if (!manualDiscount && data.discountPercent) {
        setManualDiscount(data.discountPercent);
      }
      if (data.imageUrl) setManualImageUrl(data.imageUrl);
    } catch {
      setManualError("No se pudo extraer del link.");
    } finally {
      setExtracting(false);
    }
  }

  function resetManual() {
    setManualName("");
    setManualDetail("");
    setManualBrand("");
    setManualListPrice(0);
    setManualDiscount(0);
    setManualLink("");
    setManualImageUrl("");
    setManualLine("");
    setManualFinish("");
    setManualError(null);
    // promoteToCatalog se conserva: si MJ está cargando varios para el catálogo,
    // no tiene que re-marcarlo cada vez.
  }

  async function handleAddManual() {
    if (!manualName.trim()) {
      setManualError("El nombre es obligatorio.");
      return;
    }
    await onAdd({
      catalogId: null,
      name: manualName.trim(),
      detail: manualDetail.trim() || null,
      brand: manualBrand.trim() || null,
      quantity: qty,
      listPrice: manualListPrice,
      discountPercent: manualDiscount || null,
      referenceLink: manualLink.trim() || null,
      imageUrl: manualImageUrl || null,
      promoteToCatalog,
      // Línea/color solo tienen sentido en el catálogo: se mandan al desplegar.
      line: promoteToCatalog ? manualLine.trim() || null : null,
      finish: promoteToCatalog ? manualFinish.trim() || null : null,
    });
    resetManual();
  }

  return (
    <div className="bg-gray-50 px-4 py-3 border-t border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-700">
          Agregar artefacto en {roomLabel.toLowerCase()}
        </h3>
        <div className="flex items-center gap-1 text-[11px]">
          <button
            onClick={() => setMode("search")}
            className={`px-2 py-0.5 rounded ${
              mode === "search"
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Buscar en catálogo
          </button>
          <button
            onClick={() => setMode("new")}
            className={`px-2 py-0.5 rounded ${
              mode === "new"
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Crear nuevo
          </button>
          <button
            onClick={onCancel}
            className="ml-2 text-gray-400 hover:text-gray-900"
          >
            ×
          </button>
        </div>
      </div>

      {mode === "search" ? (
        <div>
          <div className="flex gap-2 mb-3">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar WC, griferia, mueble, marca…"
              className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs outline-none focus:border-gray-500"
            />
            {/* Filtro por línea — solo aparece si la pestaña tiene líneas. */}
            {linesAvailable.length > 0 && (
              <select
                value={filterLine ?? ""}
                onChange={(e) => setFilterLine(e.target.value || null)}
                className={`px-2 py-1.5 border rounded text-xs outline-none cursor-pointer focus:border-gray-500 ${
                  filterLine
                    ? "border-gray-500 text-gray-900 font-medium"
                    : "border-gray-300 text-gray-600"
                }`}
                title="Filtrar por línea"
              >
                <option value="">Línea: todas</option>
                {linesAvailable.map((l) => (
                  <option key={l} value={l}>
                    {l.toUpperCase()}
                  </option>
                ))}
              </select>
            )}
            {/* Filtro por color/terminación. */}
            {finishesAvailable.length > 0 && (
              <select
                value={filterFinish ?? ""}
                onChange={(e) => setFilterFinish(e.target.value || null)}
                className={`px-2 py-1.5 border rounded text-xs outline-none cursor-pointer focus:border-gray-500 ${
                  filterFinish
                    ? "border-gray-500 text-gray-900 font-medium"
                    : "border-gray-300 text-gray-600"
                }`}
                title="Filtrar por color / terminación"
              >
                <option value="">Color: todos</option>
                {finishesAvailable.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            )}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-500 uppercase">cant.</span>
              <input
                type="number"
                value={qty}
                onChange={(e) => setQty(parseInt(e.target.value) || 1)}
                className="w-12 px-2 py-1.5 border border-gray-300 rounded text-xs text-center outline-none"
              />
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto bg-white border border-gray-200 rounded">
            {loading && (
              <div className="px-3 py-2 text-xs text-gray-500">
                Buscando…
              </div>
            )}
            {!loading && results.length === 0 && (
              <div className="px-3 py-4 text-xs text-gray-500 text-center">
                No hay items en el catálogo
                {query || filterLine || filterFinish
                  ? " con esa búsqueda o filtro"
                  : ""}
                {'. Apretá "Crear nuevo" para agregar uno desde cero.'}
              </div>
            )}
            {!loading &&
              results.map((it) => (
                // Fila NO clickeable entera: así MJ puede revisar (abrir el
                // link del producto) sin agregar sin querer. Solo "+ agregar"
                // suma el item.
                <div
                  key={it.id}
                  className={`grid grid-cols-[4rem_3rem_minmax(0,1.5fr)_4.5rem_4.5rem_minmax(0,1.1fr)_5.5rem] items-start gap-3 px-3 py-2 border-b border-gray-100 last:border-b-0 text-xs text-left hover:bg-gray-50 ${
                    selectedId === it.id ? "bg-gray-50" : ""
                  }`}
                  onMouseEnter={() => setSelectedId(it.id)}
                >
                  {/* "+ agregar" a la izquierda: MJ busca y lee por la izquierda,
                      así el botón queda pegado al nombre y al buscador. */}
                  <button
                    onClick={() => handleAddFromCatalog(it, qty)}
                    className="text-left text-gray-900 font-medium hover:text-gray-600"
                  >
                    + agregar
                  </button>
                  {it.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={it.imageUrl}
                      alt={it.name}
                      className="w-10 h-10 object-contain bg-white border border-gray-200 rounded"
                    />
                  ) : (
                    <div className="w-10 h-10 bg-gray-100 rounded border border-gray-200" />
                  )}
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 leading-tight break-words">
                      {it.name}
                      {it.isStandard && (
                        <span className="ml-1.5 text-[9px] text-gray-500 uppercase tracking-wider">
                          standard
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-500 leading-tight break-words">
                      {it.brand || "—"}
                      {it.supplier ? ` · ${it.supplier}` : ""}
                      {it.referenceLink && (
                        <a
                          href={it.referenceLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-1.5 text-gray-500 hover:text-gray-900 underline"
                          title="Abrir el producto en la tienda (revisar detalles)"
                        >
                          ↗ ver
                        </a>
                      )}
                    </div>
                  </div>
                  {/* Línea en MAYÚSCULA y color, igual que en el catálogo. */}
                  <div className="text-[10px] text-gray-700 uppercase leading-tight break-words">
                    {it.line ?? "—"}
                  </div>
                  <div className="text-[10px] text-gray-600 leading-tight break-words">
                    {it.finish ?? "—"}
                  </div>
                  <div className="text-gray-600 leading-tight break-words">
                    {it.detail ?? ""}
                  </div>
                  <div className="text-right tabular-nums">
                    <div className="text-gray-900 font-medium">
                      {formatCLP(it.listPrice)}
                    </div>
                    <div className="text-[10px] text-gray-500">
                      {it.discountPercent
                        ? `-${Math.round(it.discountPercent * 100)}%`
                        : "lista"}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      ) : (
        // Modo crear nuevo — mismo formulario cómodo que el catálogo.
        <div className="space-y-3">
          {/* Sugerencias de línea/color (tomadas del catálogo de la pestaña). */}
          <datalist id="add-lineas-list">
            {linesAvailable.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          <datalist id="add-colores-list">
            {finishesAvailable.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>

          {/* Atajo: pegar link del producto y extraer todo de una. */}
          <div className="bg-white border border-gray-200 rounded p-2.5">
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Atajo — pegá el link del producto y extraé foto, nombre y precio
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={manualLink}
                onChange={(e) => setManualLink(e.target.value)}
                placeholder="https://www.mk.cl/…"
                className="flex-1 bg-white border border-gray-300 rounded px-2 py-1.5 text-xs outline-none focus:border-gray-500"
              />
              <button
                onClick={handleExtractManual}
                disabled={extracting || !manualLink.trim()}
                className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded hover:bg-gray-800 disabled:opacity-50 whitespace-nowrap"
              >
                {extracting ? "Buscando…" : "Extraer"}
              </button>
            </div>
          </div>

          {manualError && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              {manualError}
            </div>
          )}

          {/* Foto + campos principales. */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
                Foto
              </label>
              <div className="flex items-center gap-1.5">
                {manualImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imgSrc(manualImageUrl)}
                    alt="preview"
                    className="w-10 h-10 object-contain bg-white border border-gray-200 rounded shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 bg-gray-100 rounded border border-gray-200 flex items-center justify-center text-gray-300 shrink-0">
                    —
                  </div>
                )}
                <label className="text-[10px] uppercase tracking-wider bg-gray-900 text-white px-2 py-1.5 rounded hover:bg-gray-800 cursor-pointer whitespace-nowrap">
                  Subir
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
                        setManualImageUrl(dataUrl);
                      } catch {
                        setManualError("No se pudo procesar la imagen.");
                      }
                    }}
                  />
                </label>
              </div>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
                Item *
              </label>
              <input
                autoFocus
                type="text"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="WC ATENAS"
                className="w-32 bg-white border border-gray-300 rounded px-2 py-1 text-xs outline-none focus:border-gray-500"
              />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
                Detalle / modelo
              </label>
              <input
                type="text"
                value={manualDetail}
                onChange={(e) => setManualDetail(e.target.value)}
                className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-xs outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
                Marca
              </label>
              <input
                type="text"
                value={manualBrand}
                onChange={(e) => setManualBrand(e.target.value)}
                className="w-24 bg-white border border-gray-300 rounded px-2 py-1 text-xs outline-none focus:border-gray-500"
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
                className="w-12 bg-white border border-gray-300 rounded px-2 py-1 text-xs text-center outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
                P. lista
              </label>
              <input
                type="number"
                value={manualListPrice || ""}
                onChange={(e) =>
                  setManualListPrice(parseFloat(e.target.value) || 0)
                }
                placeholder="0"
                className="w-24 bg-white border border-gray-300 rounded px-2 py-1 text-xs tabular-nums text-right outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
                % desc.
              </label>
              <input
                type="number"
                value={manualDiscount ? Math.round(manualDiscount * 100) : ""}
                onChange={(e) =>
                  setManualDiscount((parseFloat(e.target.value) || 0) / 100)
                }
                placeholder="0"
                className="w-12 bg-white border border-gray-300 rounded px-2 py-1 text-xs tabular-nums text-right outline-none focus:border-gray-500"
              />
            </div>
          </div>

          {/* Dónde va: solo este proyecto (default) o desplegar al catálogo. */}
          <div className="bg-gray-50 border border-gray-200 rounded p-2.5">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-gray-700">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="destino-artefacto"
                  checked={!promoteToCatalog}
                  onChange={() => setPromoteToCatalog(false)}
                  className="accent-gray-900"
                />
                <span className={!promoteToCatalog ? "font-medium text-gray-900" : ""}>
                  Solo en este proyecto
                </span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="destino-artefacto"
                  checked={promoteToCatalog}
                  onChange={() => setPromoteToCatalog(true)}
                  className="accent-gray-900"
                />
                <span className={promoteToCatalog ? "font-medium text-gray-900" : ""}>
                  Desplegar al catálogo
                  <span className="text-gray-400"> · queda buscable la próxima vez</span>
                </span>
              </label>
            </div>
            {promoteToCatalog && (
              <div className="flex flex-wrap items-end gap-3 mt-2.5 pt-2.5 border-t border-gray-200">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
                    Línea
                  </label>
                  <input
                    type="text"
                    list="add-lineas-list"
                    value={manualLine}
                    onChange={(e) => setManualLine(e.target.value)}
                    placeholder="Urban, Asis, Stellar…"
                    className="w-32 bg-white border border-gray-300 rounded px-2 py-1 text-xs outline-none focus:border-gray-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
                    Color
                  </label>
                  <input
                    type="text"
                    list="add-colores-list"
                    value={manualFinish}
                    onChange={(e) => setManualFinish(e.target.value)}
                    placeholder="Cromo, Brushed…"
                    className="w-32 bg-white border border-gray-300 rounded px-2 py-1 text-xs outline-none focus:border-gray-500"
                  />
                </div>
                <p className="text-[10px] text-gray-500 flex-1 min-w-[180px]">
                  Línea y color agrupan el artefacto dentro de su tipo en el
                  catálogo.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleAddManual}
              disabled={!manualName.trim()}
              className="text-xs bg-gray-900 text-white px-4 py-1.5 rounded hover:bg-gray-800 disabled:opacity-50"
            >
              {promoteToCatalog
                ? "Agregar y desplegar al catálogo"
                : "Agregar al proyecto"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
