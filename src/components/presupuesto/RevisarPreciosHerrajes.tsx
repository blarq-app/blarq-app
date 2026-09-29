"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCLP } from "@/lib/utils";
import { formatHerrajeName } from "@/lib/presupuesto/herrajeNombre";
import {
  seComparaConLaWeb,
  motivoSinCompararWeb,
} from "@/lib/presupuesto/herrajeProveedores";

// Lo que el modal necesita de cada línea de herraje de la partida.
export type LineaHerrajeWeb = {
  id: string;
  catalogId: string | null;
  supplier: string;
  name: string;
  measure: string | null;
  finish: string | null;
  quantity: number;
  costNet: number;
  referenceLink?: string | null;
};

// Fila de /api/catalogo/herrajes/revisar-precios (una por herraje del
// catálogo). Ese endpoint solo lee: no escribe nada.
type FilaCatalogo = {
  id: string;
  webCost: number | null;
  status: "ok" | "sin-precio" | "error";
};

/**
 * Modal "Comparar con la tienda web" para los herrajes de una partida de
 * muebles (pendiente 143, 2026-09-29). Es el MISMO modal que el de artefactos
 * (RevisarPreciosArtefactos), a propósito: MJ pidió que funcione igual, "que
 * haya coherencia en el uso de la app". Antes se probó un botón que aplicaba
 * todas las distintas de la partida de una vez ("por grupo") y MJ lo descartó:
 * se decide LÍNEA POR LÍNEA, con un tilde por herraje.
 *
 * Tres grupos, en el orden de artefactos: DISTINTOS (con tilde, marcados de
 * entrada), NO SE PUDIERON LEER (con el link para mirarlo a mano) y COINCIDEN.
 * Al final, los herrajes que no se comparan y por qué (HBT: su costo es el
 * precio negociado, no el público).
 *
 * Mirar no cambia nada. Aplicar cambia el costo de las líneas marcadas y la
 * partida se recalcula con su margen — por eso en una cotización YA ENVIADA
 * (cualquier estado que no sea borrador) la cotización no se toca: decisión
 * de MJ, "no se deben tocar cotizaciones ya enviadas". El back lo vuelve a
 * chequear.
 *
 * Opción "También en el catálogo de herrajes" (MJ: "sí aplicar en el
 * catálogo, dar la opción"): parte APAGADA, como los tildes de regla de
 * proveedor — el catálogo cambia solo si MJ lo marca. En una enviada es lo
 * único que se puede hacer ("Actualizar en el catálogo"): deja el precio de
 * hoy para las próximas cotizaciones sin tocar la que ya vio el cliente.
 */
export default function RevisarPreciosHerrajes({
  budgetId,
  itemId,
  lineas,
  cotizacionEnviada,
  onApplied,
  onClose,
}: {
  budgetId: string;
  itemId: string;
  lineas: LineaHerrajeWeb[];
  cotizacionEnviada: boolean;
  onApplied: (lines: unknown[], item: unknown) => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [porCatalogo, setPorCatalogo] = useState<Record<string, FilaCatalogo>>({});
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [applying, setApplying] = useState(false);
  const [alCatalogo, setAlCatalogo] = useState(false);
  // Confirmación cuando solo se actualizó el catálogo (la ventana queda
  // abierta: en la partida no cambia nada que se vea).
  const [hecho, setHecho] = useState<string | null>(null);

  // Las que se comparan (DPH con catálogo y link) y las que no, con motivo.
  const comparables = useMemo(
    () =>
      lineas.filter(
        (h) => h.catalogId && h.referenceLink && seComparaConLaWeb(h.supplier)
      ),
    [lineas]
  );
  const noSeComparan = lineas.filter(
    (h) => h.referenceLink && !seComparaConLaWeb(h.supplier)
  );

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const ids = [...new Set(comparables.map((h) => h.catalogId as string))];
        const res = await fetch("/api/catalogo/herrajes/revisar-precios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        const data = await res.json();
        if (cancel) return;
        if (!res.ok) {
          setLoadError(data.error || "No se pudo comparar con la web.");
          return;
        }
        const mapa: Record<string, FilaCatalogo> = {};
        for (const r of data.rows as FilaCatalogo[]) mapa[r.id] = r;
        setPorCatalogo(mapa);
        // Igual que artefactos: lo distinto viene marcado de entrada.
        const inicial: Record<string, boolean> = {};
        for (const h of comparables) {
          const w = mapa[h.catalogId as string]?.webCost;
          if (w != null && Math.abs(w - h.costNet) >= 1) inicial[h.id] = true;
        }
        setSel(inicial);
      } catch {
        if (!cancel) setLoadError("No se pudo comparar con la web.");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [comparables]);

  const { distintos, coinciden, ilegibles } = useMemo(() => {
    const distintos: { h: LineaHerrajeWeb; web: number }[] = [];
    const coinciden: LineaHerrajeWeb[] = [];
    const ilegibles: LineaHerrajeWeb[] = [];
    for (const h of comparables) {
      const w = porCatalogo[h.catalogId as string]?.webCost;
      if (w == null) ilegibles.push(h);
      else if (Math.abs(w - h.costNet) >= 1) distintos.push({ h, web: w });
      else coinciden.push(h);
    }
    return { distintos, coinciden, ilegibles };
  }, [comparables, porCatalogo]);

  const marcados = distintos.filter(({ h }) => sel[h.id]);

  // En una enviada lo único posible es el catálogo.
  const aCotizacion = !cotizacionEnviada;
  const aCatalogo = cotizacionEnviada || alCatalogo;

  async function handleApply() {
    if (marcados.length === 0) return;
    setApplying(true);
    setHecho(null);
    try {
      const res = await fetch(
        `/api/presupuestos/${budgetId}/muebles/items/${itemId}/herrajes/aplicar-web`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lineIds: marcados.map(({ h }) => h.id),
            cotizacion: aCotizacion,
            catalogo: aCatalogo,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "No se pudieron aplicar los precios de la web.");
        return;
      }
      const r: { lineas: number; catalogo: number; sinLeer: number } = data.resumen;
      // Si la web no respondió justo al aplicar, ese herraje quedó igual.
      const avisoSinLeer =
        r.sinLeer > 0
          ? ` ${r.sinLeer} no se pudo leer al aplicar y quedó igual.`
          : "";
      if (r.lineas > 0) onApplied(data.lines, data.item);
      if (aCotizacion) {
        if (avisoSinLeer) alert(avisoSinLeer.trim());
        onClose();
        return;
      }
      setHecho(
        (r.catalogo > 0
          ? `Listo: ${r.catalogo === 1 ? "1 herraje quedó" : `${r.catalogo} herrajes quedaron`} al día en el catálogo.`
          : "El catálogo ya tenía esos precios.") + avisoSinLeer
      );
      setSel({});
    } finally {
      setApplying(false);
    }
  }

  function detalle(h: LineaHerrajeWeb): string {
    return [h.measure, h.finish]
      .filter(Boolean)
      .map((s) => (s as string).toUpperCase())
      .join(" · ");
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
            Entra al link de cada herraje y compara su costo con el precio de
            hoy en la web del proveedor. Mirar no cambia nada: se aplica solo lo
            que marques.
          </p>
          {cotizacionEnviada && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-3">
              Esta cotización ya se envió al cliente: sus precios no se
              cambian. Lo que marques se puede dejar al día en el catálogo de
              herrajes, para las próximas cotizaciones.
            </div>
          )}
        </div>

        {/* Cuerpo */}
        <div className="overflow-y-auto flex-1 min-h-0 px-6 py-4">
          {loading && (
            <div className="text-sm text-gray-500 py-8 text-center">
              Revisando los links en la web… esto puede tardar unos segundos.
            </div>
          )}

          {!loading && loadError && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              {loadError}
            </div>
          )}

          {!loading && !loadError && (
            <>
              {/* Resumen de una línea, igual que artefactos */}
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
              </div>

              {/* ── Distintos: lo único accionable ─────────────────────── */}
              {distintos.length > 0 && (
                <div className="mb-5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
                    Distintos — marcá qué aplicar
                  </div>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3 px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                      <div>Herraje</div>
                      <div>Costo unitario — hoy en la web</div>
                    </div>
                    {distintos.map(({ h, web }) => {
                      const delta = web - h.costNet;
                      const precio = (
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-baseline gap-x-1.5">
                            <span className="tabular-nums text-gray-400 line-through">
                              {formatCLP(h.costNet)}
                            </span>
                            <span className="tabular-nums font-semibold text-gray-900">
                              {formatCLP(web)}
                            </span>
                            <span
                              className={`tabular-nums text-[10px] ${
                                delta > 0 ? "text-red-700" : "text-green-700"
                              }`}
                            >
                              {delta > 0 ? "+" : "−"}
                              {formatCLP(Math.abs(delta))}
                            </span>
                          </span>
                          <span className="block text-[10px] text-gray-500 tabular-nums">
                            ×{h.quantity} en la partida: {delta > 0 ? "+" : "−"}
                            {formatCLP(Math.abs(delta * h.quantity))}
                          </span>
                        </span>
                      );
                      return (
                        <div
                          key={h.id}
                          className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3 px-3 py-2.5 border-b border-gray-100 last:border-b-0 text-xs items-center"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-gray-900 truncate">
                              {formatHerrajeName(h.name)}
                            </div>
                            <div className="text-[10px] text-gray-500 uppercase tracking-wider">
                              {[detalle(h), h.supplier].filter(Boolean).join(" · ")}
                            </div>
                          </div>
                          <label className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!!sel[h.id]}
                              onChange={() =>
                                setSel((p) => ({ ...p, [h.id]: !p[h.id] }))
                              }
                              className="accent-gray-900 mt-0.5"
                            />
                            {precio}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                  {!cotizacionEnviada && (
                    <p className="text-[10px] text-gray-500 mt-1.5">
                      Aplicar cambia el costo de esta cotización y la partida se
                      recalcula con su margen. El catálogo de herrajes cambia
                      solo si marcás la opción de abajo.
                    </p>
                  )}
                </div>
              )}

              {/* ── No se pudieron leer: para mirarlos a mano ───────────── */}
              {ilegibles.length > 0 && (
                <div className="mb-5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
                    No se pudieron leer — revisá el link
                  </div>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    {ilegibles.map((h) => (
                      <div
                        key={h.id}
                        className="px-3 py-2 border-b border-gray-100 last:border-b-0 text-xs flex items-baseline justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <span className="font-semibold text-gray-900">
                            {formatHerrajeName(h.name)}
                          </span>
                          <span className="text-[10px] text-gray-500 uppercase tracking-wider ml-2">
                            {detalle(h)}
                          </span>
                          <div className="text-[11px] text-amber-700 mt-0.5">
                            La web no devolvió el precio de este herraje.
                          </div>
                        </div>
                        <a
                          href={h.referenceLink as string}
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
                <div className="mb-5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
                    Coinciden con la web
                  </div>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    {coinciden.map((h) => (
                      <div
                        key={h.id}
                        className="px-3 py-1.5 border-b border-gray-100 last:border-b-0 text-xs flex items-baseline justify-between gap-3 text-gray-500"
                      >
                        <span className="truncate">
                          {formatHerrajeName(h.name)}
                          <span className="text-[10px] uppercase tracking-wider ml-2">
                            {detalle(h)}
                          </span>
                        </span>
                        <span className="tabular-nums shrink-0">
                          {formatCLP(h.costNet)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Los que no se comparan, y por qué (en vez de esconderlos). */}
              {noSeComparan.length > 0 && (
                <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                  {noSeComparan.length === 1
                    ? "1 herraje no se compara"
                    : `${noSeComparan.length} herrajes no se comparan`}
                  :{" "}
                  {[...new Set(noSeComparan.map((h) => h.supplier))]
                    .map((s) => `${s} (${motivoSinCompararWeb(s)})`)
                    .join(" · ")}
                  . Tienen su ↗ para mirarlos a mano.
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between gap-4">
          <span className="text-xs text-gray-500">
            {hecho ? (
              <span className="text-green-700">{hecho}</span>
            ) : !loading && distintos.length > 0 ? (
              `${marcados.length} de ${distintos.length} marcados`
            ) : (
              ""
            )}
          </span>
          <div className="flex items-center gap-3">
            {/* La opción del catálogo, apagada de entrada. En una enviada no
                hace falta: el catálogo es lo único que se puede tocar. */}
            {!cotizacionEnviada && distintos.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={alCatalogo}
                  onChange={(e) => setAlCatalogo(e.target.checked)}
                  className="accent-gray-900"
                />
                También en el catálogo de herrajes
              </label>
            )}
            <button
              onClick={onClose}
              className="text-xs text-gray-600 px-3 py-2 hover:text-gray-900"
            >
              Cerrar
            </button>
            {distintos.length > 0 && (
              <button
                onClick={handleApply}
                disabled={loading || applying || marcados.length === 0}
                className="text-xs bg-gray-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50"
              >
                {applying
                  ? "Aplicando…"
                  : cotizacionEnviada
                    ? "Actualizar en el catálogo"
                    : "Aplicar cambios marcados"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
