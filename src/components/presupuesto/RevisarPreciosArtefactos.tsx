"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCLP } from "@/lib/utils";

// Shape del diff que devuelve /api/presupuestos/[id]/artefactos/revisar-precios
interface OnlineDiff {
  itemId: string;
  name: string;
  room: string;
  referenceLink: string;
  currentListPrice: number;
  currentImageUrl: string | null;
  fetched: {
    listPrice: number | null;
    imageUrl: string | null;
    name: string | null;
    brand: string | null;
  } | null;
  error: string | null;
}

interface RevisarResult {
  diffs: OnlineDiff[];
  skippedNoLink: number;
}

// Cambio que el editor va a aplicar a un item.
export interface ArtefactoPricePatch {
  itemId: string;
  listPrice?: number;
  imageUrl?: string;
}

const ROOM_LABELS: Record<string, string> = {
  bano_principal: "Baño principal",
  bano_secundario: "Baño secundario",
  bano_visita: "Baño visita",
  cocina: "Cocina",
  lavadero: "Lavadero",
  otro: "Otro",
};

/**
 * Modal "Revisar online" para artefactos.
 *
 * Al abrirse consulta la tienda de cada item con link cargado y muestra
 * un diff: precio actual vs. precio del momento, imagen actual vs. imagen
 * del sitio. MJ marca qué cambios aplicar y aprieta "Aplicar".
 */
export default function RevisarPreciosArtefactos({
  budgetId,
  onApply,
  onClose,
}: {
  budgetId: string;
  onApply: (patches: ArtefactoPricePatch[]) => Promise<void>;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<RevisarResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // Selección por item: qué cambios aplicar.
  const [sel, setSel] = useState<
    Record<string, { price: boolean; image: boolean }>
  >({});

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/presupuestos/${budgetId}/artefactos/revisar-precios`
        );
        const data = await res.json();
        if (cancel) return;
        if (!res.ok) {
          setLoadError(data.error || "Error al revisar precios.");
          return;
        }
        setResult(data);
        // Pre-marcamos todo lo accionable: cambios de precio reales y
        // huecos de imagen que la tienda puede llenar.
        const initial: Record<string, { price: boolean; image: boolean }> = {};
        for (const d of (data as RevisarResult).diffs) {
          if (!d.fetched) continue;
          const priceChanged =
            !!d.fetched.listPrice &&
            d.fetched.listPrice > 0 &&
            d.fetched.listPrice !== d.currentListPrice;
          const imageActionable =
            !!d.fetched.imageUrl && d.fetched.imageUrl !== d.currentImageUrl;
          if (priceChanged || imageActionable) {
            initial[d.itemId] = {
              price: priceChanged,
              image: imageActionable,
            };
          }
        }
        setSel(initial);
      } catch {
        if (!cancel) setLoadError("No se pudo revisar precios online.");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [budgetId]);

  // Clasificamos cada diff para el render.
  const rows = useMemo(() => {
    if (!result) return [];
    return result.diffs.map((d) => {
      const priceChanged =
        !!d.fetched?.listPrice &&
        d.fetched.listPrice > 0 &&
        d.fetched.listPrice !== d.currentListPrice;
      const imageActionable =
        !!d.fetched?.imageUrl && d.fetched.imageUrl !== d.currentImageUrl;
      return { d, priceChanged, imageActionable };
    });
  }, [result]);

  const actionableCount = rows.filter(
    (r) => r.priceChanged || r.imageActionable
  ).length;
  const selectedCount = Object.values(sel).filter(
    (s) => s.price || s.image
  ).length;

  function toggle(itemId: string, kind: "price" | "image") {
    setSel((prev) => {
      const cur = prev[itemId] ?? { price: false, image: false };
      return { ...prev, [itemId]: { ...cur, [kind]: !cur[kind] } };
    });
  }

  async function handleApply() {
    if (!result) return;
    const patches: ArtefactoPricePatch[] = [];
    for (const { d } of rows) {
      const s = sel[d.itemId];
      if (!s || (!s.price && !s.image) || !d.fetched) continue;
      const patch: ArtefactoPricePatch = { itemId: d.itemId };
      if (s.price && d.fetched.listPrice && d.fetched.listPrice > 0) {
        patch.listPrice = d.fetched.listPrice;
      }
      if (s.image && d.fetched.imageUrl) {
        patch.imageUrl = d.fetched.imageUrl;
      }
      if (patch.listPrice !== undefined || patch.imageUrl !== undefined) {
        patches.push(patch);
      }
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
        className="bg-white rounded-xl shadow-sm border border-gray-200 max-w-3xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
            Revisar precios online
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Compara el precio y la imagen de cada artefacto con la tienda del
            link. Marcá qué cambios querés aplicar.
          </p>
        </div>

        {/* Cuerpo */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {loading && (
            <div className="text-sm text-gray-500 py-8 text-center">
              Revisando los links en las tiendas… esto puede tardar unos
              segundos.
            </div>
          )}

          {!loading && loadError && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              {loadError}
            </div>
          )}

          {!loading && result && (
            <>
              {result.skippedNoLink > 0 && (
                <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2 mb-3">
                  {result.skippedNoLink} artefacto
                  {result.skippedNoLink === 1 ? "" : "s"} sin link — no se
                  pueden revisar online. Cargales el link desde la columna de
                  imagen.
                </div>
              )}

              {result.diffs.length === 0 && (
                <div className="text-sm text-gray-500 py-8 text-center">
                  Ningún artefacto tiene link cargado para revisar.
                </div>
              )}

              {result.diffs.length > 0 && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  {/* Header de columnas */}
                  <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,1fr)] gap-3 px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    <div>Artefacto</div>
                    <div>Precio lista</div>
                    <div>Imagen</div>
                  </div>

                  {rows.map(({ d, priceChanged, imageActionable }) => {
                    const s = sel[d.itemId] ?? {
                      price: false,
                      image: false,
                    };
                    return (
                      <div
                        key={d.itemId}
                        className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,1fr)] gap-3 px-3 py-2.5 border-b border-gray-100 last:border-b-0 text-xs items-center"
                      >
                        {/* Artefacto */}
                        <div className="min-w-0">
                          <div className="font-semibold text-gray-900 truncate">
                            {d.name}
                          </div>
                          <div className="text-[10px] text-gray-500 uppercase tracking-wider">
                            {ROOM_LABELS[d.room] ?? d.room}
                          </div>
                        </div>

                        {/* Precio */}
                        <div>
                          {d.error ? (
                            <span className="text-[11px] text-amber-700">
                              {d.error}
                            </span>
                          ) : priceChanged && d.fetched ? (
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={s.price}
                                onChange={() => toggle(d.itemId, "price")}
                                className="accent-gray-900"
                              />
                              <span className="tabular-nums text-gray-400 line-through">
                                {formatCLP(d.currentListPrice)}
                              </span>
                              <span className="text-gray-400">→</span>
                              <span
                                className={`tabular-nums font-semibold ${
                                  (d.fetched.listPrice ?? 0) >
                                  d.currentListPrice
                                    ? "text-red-700"
                                    : "text-green-700"
                                }`}
                              >
                                {formatCLP(d.fetched.listPrice ?? 0)}
                              </span>
                            </label>
                          ) : (
                            <span className="text-gray-400 tabular-nums">
                              {formatCLP(d.currentListPrice)}{" "}
                              <span className="text-[10px]">sin cambio</span>
                            </span>
                          )}
                        </div>

                        {/* Imagen */}
                        <div>
                          {imageActionable && d.fetched?.imageUrl ? (
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={s.image}
                                onChange={() => toggle(d.itemId, "image")}
                                className="accent-gray-900"
                              />
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={d.fetched.imageUrl}
                                alt=""
                                className="w-9 h-9 object-contain border border-gray-200 rounded bg-white"
                              />
                              <span className="text-[10px] text-gray-500">
                                {d.currentImageUrl
                                  ? "actualizar"
                                  : "agregar"}
                              </span>
                            </label>
                          ) : (
                            <span className="text-gray-400 text-[10px]">
                              {d.currentImageUrl ? "sin cambio" : "—"}
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
