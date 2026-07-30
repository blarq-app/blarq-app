"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCLP } from "@/lib/utils";
import { roomLabel } from "@/lib/presupuesto/ambientes";

// Shape del diff que devuelve /api/presupuestos/[id]/artefactos/revisar-precios
interface OnlineDiff {
  itemId: string;
  name: string;
  room: string;
  referenceLink: string;
  currentListPrice: number;
  currentImageUrl: string | null;
  // La línea tiene el precio editado a mano: no sigue al catálogo.
  priceOverridden: boolean;
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


/**
 * Modal "Comparar con la tienda web" para artefactos.
 *
 * Al abrirse entra al link de cada artefacto y muestra tres grupos, en este
 * orden: los que están DISTINTOS (con la diferencia en pesos), los que
 * COINCIDEN, y los links que NO SE PUDIERON LEER — estos últimos para que MJ
 * sepa cuáles tiene que recargar a mano.
 *
 * Leer no toca nada. Aplicar es explícito: MJ marca fila por fila y recién
 * ahí se escribe. Los ítems con precio editado a mano ("despegados") se
 * comparan igual, pero vienen SIN marcar y con aviso, para no pisar de
 * corrido un precio negociado (decisión de MJ, 2026-07-29).
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
        // Pre-marcamos lo accionable, con una excepción: el precio de una
        // línea despegada NO viene marcado (lo editó MJ a mano; pisarlo de
        // corrido con "aplicar" sería perder un precio negociado).
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
              price: priceChanged && !d.priceOverridden,
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

  // Clasificamos cada diff y lo repartimos en los tres grupos del modal.
  const { distintos, coinciden, ilegibles } = useMemo(() => {
    const distintos: Array<{
      d: OnlineDiff;
      priceChanged: boolean;
      imageActionable: boolean;
    }> = [];
    const coinciden: OnlineDiff[] = [];
    const ilegibles: OnlineDiff[] = [];
    for (const d of result?.diffs ?? []) {
      // Sin datos de la tienda (link caído, sitio que no expone precio):
      // no es "coincide", es "no se pudo leer".
      if (d.error || !d.fetched) {
        ilegibles.push(d);
        continue;
      }
      const priceChanged =
        !!d.fetched.listPrice &&
        d.fetched.listPrice > 0 &&
        d.fetched.listPrice !== d.currentListPrice;
      const imageActionable =
        !!d.fetched.imageUrl && d.fetched.imageUrl !== d.currentImageUrl;
      if (priceChanged || imageActionable) {
        distintos.push({ d, priceChanged, imageActionable });
      } else {
        coinciden.push(d);
      }
    }
    return { distintos, coinciden, ilegibles };
  }, [result]);

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
    for (const { d } of distintos) {
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
            Comparar con la tienda web
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Entra al link de cada artefacto y compara contra el precio de hoy.
            Mirar no cambia nada: se aplica solo lo que marques.
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
              {/* Resumen de una línea: el titular antes del detalle */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 mb-3">
                <span>
                  <span className="font-semibold text-gray-900 tabular-nums">
                    {distintos.length}
                  </span>{" "}
                  {distintos.length === 1 ? "distinto" : "distintos"}
                </span>
                <span>
                  <span className="tabular-nums">{coinciden.length}</span>{" "}
                  {coinciden.length === 1 ? "coincide" : "coinciden"}
                </span>
                <span>
                  <span className="tabular-nums">{ilegibles.length}</span> sin
                  poder leer
                </span>
                {result.skippedNoLink > 0 && (
                  <span>
                    <span className="tabular-nums">{result.skippedNoLink}</span>{" "}
                    sin link
                  </span>
                )}
              </div>

              {result.diffs.length === 0 && (
                <div className="text-sm text-gray-500 py-8 text-center">
                  Ningún artefacto tiene link cargado para revisar.
                </div>
              )}

              {/* ── Distintos: lo único accionable ─────────────────────── */}
              {distintos.length > 0 && (
                <div className="mb-5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
                    Distintos — marcá qué aplicar
                  </div>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.7fr)_minmax(0,0.9fr)] gap-3 px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                      <div>Artefacto</div>
                      <div>Precio lista</div>
                      <div>Imagen</div>
                    </div>

                    {distintos.map(({ d, priceChanged, imageActionable }) => {
                      const s = sel[d.itemId] ?? { price: false, image: false };
                      const nuevo = d.fetched?.listPrice ?? 0;
                      const delta = nuevo - d.currentListPrice;
                      const subio = delta > 0;
                      return (
                        <div
                          key={d.itemId}
                          className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.7fr)_minmax(0,0.9fr)] gap-3 px-3 py-2.5 border-b border-gray-100 last:border-b-0 text-xs items-center"
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

                          {/* Precio */}
                          <div>
                            {priceChanged ? (
                              <>
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
                                  <span className="tabular-nums font-semibold text-gray-900">
                                    {formatCLP(nuevo)}
                                  </span>
                                  <span
                                    className={`tabular-nums text-[10px] ${
                                      subio ? "text-red-700" : "text-green-700"
                                    }`}
                                  >
                                    {subio ? "+" : "−"}
                                    {formatCLP(Math.abs(delta))}
                                  </span>
                                </label>
                                {d.priceOverridden && (
                                  <div className="text-[10px] text-amber-700 mt-1 pl-6">
                                    Precio editado a mano — no viene marcado
                                  </div>
                                )}
                              </>
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
                                  {d.currentImageUrl ? "actualizar" : "agregar"}
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
                </div>
              )}

              {/* ── No se pudieron leer: la lista para recargar a mano ─── */}
              {ilegibles.length > 0 && (
                <div className="mb-5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
                    No se pudieron leer — revisá el link
                  </div>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    {ilegibles.map((d) => (
                      <div
                        key={d.itemId}
                        className="px-3 py-2 border-b border-gray-100 last:border-b-0 text-xs flex items-baseline justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <span className="font-semibold text-gray-900">
                            {d.name}
                          </span>
                          <span className="text-[10px] text-gray-500 uppercase tracking-wider ml-2">
                            {roomLabel(d.room)}
                          </span>
                          <div className="text-[11px] text-amber-700 mt-0.5">
                            {d.error ??
                              "La tienda no devolvió datos del producto."}
                          </div>
                        </div>
                        <a
                          href={d.referenceLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-gray-600 underline shrink-0 hover:text-gray-900"
                        >
                          Abrir link
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Coinciden: al final, discretos ──────────────────────── */}
              {coinciden.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
                    Coinciden con la web
                  </div>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    {coinciden.map((d) => (
                      <div
                        key={d.itemId}
                        className="px-3 py-1.5 border-b border-gray-100 last:border-b-0 text-xs flex items-baseline justify-between gap-3 text-gray-500"
                      >
                        <span className="truncate">
                          {d.name}
                          <span className="text-[10px] uppercase tracking-wider ml-2">
                            {roomLabel(d.room)}
                          </span>
                        </span>
                        <span className="tabular-nums shrink-0">
                          {formatCLP(d.currentListPrice)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.skippedNoLink > 0 && (
                <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2 mt-4">
                  {result.skippedNoLink} artefacto
                  {result.skippedNoLink === 1 ? "" : "s"} sin link — no se
                  pueden comparar con la web. Cargales el link desde la columna
                  de imagen.
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <span className="text-xs text-gray-500">
            {!loading && result
              ? `${selectedCount} de ${distintos.length} con cambios marcados`
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
