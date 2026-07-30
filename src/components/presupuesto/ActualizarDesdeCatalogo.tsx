"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCLP } from "@/lib/utils";
import { roomLabel } from "@/lib/presupuesto/ambientes";

// Shape del diff que devuelve
// /api/presupuestos/[id]/artefactos/actualizar-catalogo
interface CatalogValues {
  realCostBlarq: number | null;
  clientPrice: number | null;
  listPrice: number;
  discountPercent?: number; // solo viene en el lado `catalog`
  imageUrl: string | null;
  referenceLink: string | null;
}

interface CatalogDiff {
  itemId: string;
  name: string;
  room: string;
  catalogName: string;
  current: CatalogValues;
  catalog: CatalogValues;
}

interface DiffResult {
  diffs: CatalogDiff[];
  skippedNoCatalog: number;
  skippedCatalogGone: number;
}

// Cambio que el editor aplica a un item al bajar datos del catálogo.
// El editor lo pasa por updateItem: listPrice + discountPercent recalculan
// el clientPrice; realCostBlarq / imageUrl / referenceLink van directo.
export interface CatalogApplyPatch {
  itemId: string;
  listPrice?: number;
  discountPercent?: number;
  realCostBlarq?: number;
  imageUrl?: string;
  referenceLink?: string | null;
}


// Dos montos se consideran iguales si difieren menos de 1 peso. Evita falsos
// cambios por colita decimal (ej. clientPrice guardado como 79990.00000001).
function sameMoney(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a === b;
  return Math.abs(a - b) < 1;
}
// ¿El costo del catálogo aporta algo? (tiene valor y difiere del actual)
function costActionable(d: CatalogDiff): boolean {
  const c = d.catalog.realCostBlarq;
  return c != null && c > 0 && !sameMoney(c, d.current.realCostBlarq);
}
// ¿El precio a cliente del catálogo difiere del de la cotización?
function priceActionable(d: CatalogDiff): boolean {
  const c = d.catalog.clientPrice;
  return c != null && c > 0 && !sameMoney(c, d.current.clientPrice);
}
// ¿La foto del catálogo aporta (la cotización no la tiene o es distinta)?
function imageActionable(d: CatalogDiff): boolean {
  return !!d.catalog.imageUrl && d.catalog.imageUrl !== d.current.imageUrl;
}

/**
 * Modal "Comparar con mi catálogo" para artefactos de una cotización.
 * (Se llamaba "Actualizar del catálogo" hasta 2026-07-29; se renombró en
 * espejo con "Comparar con la tienda web" para que se lea contra qué
 * compara cada uno.)
 *
 * Al abrirse compara cada artefacto con su producto del catálogo BLARQ y
 * muestra un diff de costo interno, precio a cliente y foto. MJ marca qué
 * bajar. Por defecto viene pre-marcado el COSTO (lo seguro de actualizar);
 * el precio a cliente queda sin marcar para no pisar un precio negociado.
 */
export default function ActualizarDesdeCatalogo({
  budgetId,
  onApply,
  onClose,
}: {
  budgetId: string;
  onApply: (patches: CatalogApplyPatch[]) => Promise<void>;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<DiffResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // Selección por item: qué dimensiones bajar.
  const [sel, setSel] = useState<
    Record<string, { cost: boolean; price: boolean; image: boolean }>
  >({});

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/presupuestos/${budgetId}/artefactos/actualizar-catalogo`
        );
        const data = await res.json();
        if (cancel) return;
        if (!res.ok) {
          setLoadError(data.error || "Error al comparar con el catálogo.");
          return;
        }
        setResult(data);
        // Pre-marcamos solo el costo (seguro). Precio y foto, decisión de MJ.
        const initial: Record<
          string,
          { cost: boolean; price: boolean; image: boolean }
        > = {};
        for (const d of (data as DiffResult).diffs) {
          const cost = costActionable(d);
          const price = priceActionable(d);
          const image = imageActionable(d);
          if (cost || price || image) {
            initial[d.itemId] = { cost, price: false, image: false };
            // Mantener referencia a price/image actionable se calcula en render.
          }
        }
        setSel(initial);
      } catch {
        if (!cancel) setLoadError("No se pudo comparar con el catálogo.");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [budgetId]);

  const rows = useMemo(() => {
    if (!result) return [];
    return result.diffs.map((d) => ({
      d,
      cost: costActionable(d),
      price: priceActionable(d),
      image: imageActionable(d),
    }));
  }, [result]);

  const actionableCount = rows.filter(
    (r) => r.cost || r.price || r.image
  ).length;
  const selectedCount = Object.entries(sel).filter(
    ([, s]) => s.cost || s.price || s.image
  ).length;

  function toggle(itemId: string, kind: "cost" | "price" | "image") {
    setSel((prev) => {
      const cur = prev[itemId] ?? { cost: false, price: false, image: false };
      return { ...prev, [itemId]: { ...cur, [kind]: !cur[kind] } };
    });
  }

  async function handleApply() {
    if (!result) return;
    const patches: CatalogApplyPatch[] = [];
    for (const { d } of rows) {
      const s = sel[d.itemId];
      if (!s || (!s.cost && !s.price && !s.image)) continue;
      const patch: CatalogApplyPatch = { itemId: d.itemId };

      if (s.cost && d.catalog.realCostBlarq != null) {
        patch.realCostBlarq = d.catalog.realCostBlarq;
      }
      if (s.price && d.catalog.clientPrice != null && d.catalog.clientPrice > 0) {
        // Bajamos lista + descuento tal cual del catálogo (el editor recalcula
        // clientPrice = lista × (1 − dcto)). Así la columna DCTO de la
        // cotización queda con el descuento de la web, igual que en el catálogo.
        patch.listPrice = d.catalog.listPrice;
        patch.discountPercent = d.catalog.discountPercent ?? 0;
      }
      if (s.image && d.catalog.imageUrl) {
        patch.imageUrl = d.catalog.imageUrl;
        // La foto suele venir con su link del catálogo; lo traemos junto.
        if (d.catalog.referenceLink) patch.referenceLink = d.catalog.referenceLink;
      }

      const hasChange =
        patch.realCostBlarq !== undefined ||
        patch.listPrice !== undefined ||
        patch.imageUrl !== undefined;
      if (hasChange) patches.push(patch);
    }
    if (patches.length === 0) {
      onClose();
      return;
    }
    setApplying(true);
    try {
      await onApply(patches);
      onClose();
    } finally {
      setApplying(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-sm border border-gray-200 max-w-4xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
            Comparar con mi catálogo
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Compara cada artefacto con su producto en el catálogo BLARQ. El
            costo viene pre-marcado; el precio a cliente y la foto los marcás vos.
          </p>
        </div>

        {/* Cuerpo */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {loading && (
            <div className="text-sm text-gray-500 py-8 text-center">
              Comparando con el catálogo…
            </div>
          )}

          {!loading && loadError && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              {loadError}
            </div>
          )}

          {!loading && result && (
            <>
              {(result.skippedNoCatalog > 0 ||
                result.skippedCatalogGone > 0) && (
                <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2 mb-3">
                  {result.skippedNoCatalog > 0 && (
                    <div>
                      {result.skippedNoCatalog} artefacto
                      {result.skippedNoCatalog === 1 ? "" : "s"} sin link al
                      catálogo — no se pueden actualizar desde acá.
                    </div>
                  )}
                  {result.skippedCatalogGone > 0 && (
                    <div>
                      {result.skippedCatalogGone} linkeado
                      {result.skippedCatalogGone === 1 ? "" : "s"} a un producto
                      que ya no está en el catálogo.
                    </div>
                  )}
                </div>
              )}

              {actionableCount === 0 && (
                <div className="text-sm text-gray-500 py-8 text-center">
                  Todo al día — no hay diferencias con el catálogo.
                </div>
              )}

              {rows.length > 0 && actionableCount > 0 && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  {/* Header de columnas */}
                  <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,0.9fr)] gap-3 px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    <div>Artefacto</div>
                    <div>Costo (neto BLARQ)</div>
                    <div>Precio cliente</div>
                    <div>Foto</div>
                  </div>

                  {rows.map(({ d, cost, price, image }) => {
                    if (!cost && !price && !image) return null;
                    const s = sel[d.itemId] ?? {
                      cost: false,
                      price: false,
                      image: false,
                    };
                    return (
                      <div
                        key={d.itemId}
                        className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,0.9fr)] gap-3 px-3 py-2.5 border-b border-gray-100 last:border-b-0 text-xs items-center"
                      >
                        {/* Artefacto */}
                        <div className="min-w-0">
                          <div className="font-semibold text-gray-900 truncate">
                            {d.name}
                          </div>
                          <div className="text-[10px] text-gray-500 uppercase tracking-wider">
                            {roomLabel(d.room)}
                          </div>
                        </div>

                        {/* Costo */}
                        <div>
                          {cost ? (
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={s.cost}
                                onChange={() => toggle(d.itemId, "cost")}
                                className="accent-gray-900"
                              />
                              <span className="tabular-nums text-gray-400 line-through">
                                {d.current.realCostBlarq != null
                                  ? formatCLP(d.current.realCostBlarq)
                                  : "—"}
                              </span>
                              <span className="text-gray-400">→</span>
                              <span className="tabular-nums font-semibold text-gray-900">
                                {formatCLP(d.catalog.realCostBlarq ?? 0)}
                              </span>
                            </label>
                          ) : (
                            <span className="text-gray-400 tabular-nums">
                              {d.current.realCostBlarq != null
                                ? formatCLP(d.current.realCostBlarq)
                                : "—"}{" "}
                              <span className="text-[10px]">sin cambio</span>
                            </span>
                          )}
                        </div>

                        {/* Precio cliente */}
                        <div>
                          {price ? (
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={s.price}
                                onChange={() => toggle(d.itemId, "price")}
                                className="accent-gray-900"
                              />
                              <span className="tabular-nums text-gray-400 line-through">
                                {formatCLP(d.current.clientPrice ?? 0)}
                              </span>
                              <span className="text-gray-400">→</span>
                              <span
                                className={`tabular-nums font-semibold ${
                                  (d.catalog.clientPrice ?? 0) >
                                  (d.current.clientPrice ?? 0)
                                    ? "text-red-700"
                                    : "text-green-700"
                                }`}
                              >
                                {formatCLP(d.catalog.clientPrice ?? 0)}
                              </span>
                            </label>
                          ) : (
                            <span className="text-gray-400 tabular-nums">
                              {formatCLP(d.current.clientPrice ?? 0)}{" "}
                              <span className="text-[10px]">sin cambio</span>
                            </span>
                          )}
                        </div>

                        {/* Foto */}
                        <div>
                          {image && d.catalog.imageUrl ? (
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={s.image}
                                onChange={() => toggle(d.itemId, "image")}
                                className="accent-gray-900"
                              />
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={d.catalog.imageUrl}
                                alt=""
                                className="w-9 h-9 object-contain border border-gray-200 rounded bg-white"
                              />
                              <span className="text-[10px] text-gray-500">
                                {d.current.imageUrl ? "actualizar" : "agregar"}
                              </span>
                            </label>
                          ) : (
                            <span className="text-gray-400 text-[10px]">
                              {d.current.imageUrl ? "sin cambio" : "—"}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <span className="text-xs text-gray-500">
            {!loading && result
              ? `${selectedCount} de ${actionableCount} con cambios marcados`
              : ""}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-xs text-gray-600 px-3 py-2 hover:text-gray-900"
            >
              Cerrar
            </button>
            <button
              onClick={handleApply}
              disabled={loading || applying || selectedCount === 0}
              className="text-xs bg-gray-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50"
            >
              {applying ? "Aplicando…" : "Aplicar cambios marcados"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
