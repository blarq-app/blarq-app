"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCLP } from "@/lib/utils";

// Iconos inline al estilo del resto de la app (Heroicons outline, currentColor).
// El proyecto no usa una librería de iconos, así que los definimos acá.
function Icon({
  path,
  className = "w-4 h-4",
}: {
  path: string;
  className?: string;
}) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}
const IconX = (p: { className?: string }) => (
  <Icon path="M6 18L18 6M6 6l12 12" {...p} />
);
const IconSearch = (p: { className?: string }) => (
  <Icon path="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" {...p} />
);
const IconStar = (p: { className?: string }) => (
  <Icon
    path="M11.48 3.5a.56.56 0 011.04 0l2.12 4.7 5.1.52c.46.05.64.62.3.93l-3.84 3.4 1.1 5.03c.1.45-.39.8-.79.56L12 16.5l-4.51 2.64c-.4.24-.89-.11-.79-.56l1.1-5.03-3.84-3.4a.56.56 0 01.3-.93l5.1-.52 2.12-4.7z"
    {...p}
  />
);
const IconTrash = (p: { className?: string }) => (
  <Icon
    path="M19 7l-.87 12.14A2 2 0 0116.14 21H7.86a2 2 0 01-1.99-1.86L5 7m5 4v6m4-6v6M4 7h16M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"
    {...p}
  />
);
const IconExternal = (p: { className?: string }) => (
  <Icon
    path="M14 5h5v5M19 5l-7 7M19 14v5H5V5h5"
    {...p}
  />
);
const IconCheck = (p: { className?: string }) => (
  <Icon path="M5 13l4 4L19 7" {...p} />
);
const IconSpinner = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg
    className={`${className} animate-spin`}
    fill="none"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
    />
  </svg>
);

// Tiendas con búsqueda en vivo (deben coincidir con VTEX_STORES del backend).
const SEARCHABLE_STORES = [{ key: "mk", label: "mK" }];

// Etiqueta legible por key de tienda (coincide con MaterialPriceOffer.store).
const STORE_LABELS: Record<string, string> = {
  sodimac: "Sodimac",
  easy: "Easy",
  mk: "mK",
  construmart: "Construmart",
  mercadolibre: "MercadoLibre",
  imperial: "Imperial",
  chilemat: "Chilemat",
  otro: "Otro",
};

function storeLabel(key: string) {
  return STORE_LABELS[key] ?? key;
}

// El nombre exacto del catálogo (ej "GUARDAPOLVO FOLIADO 15X90X2400MM") suele
// ser demasiado específico para el buscador de la tienda y no devuelve nada.
// Lo suavizamos como punto de partida: minúsculas y la medida triple
// "15x90x2400mm" colapsada a la doble "15x90". MJ puede reescribir igual.
function searchHintFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/(\d+)\s*x\s*(\d+)\s*x\s*\d+\s*mm\b/gi, "$1x$2")
    .replace(/\s+/g, " ")
    .trim();
}

interface Offer {
  id: string;
  store: string;
  productName: string;
  productUrl: string | null;
  price: number;
  priceNet: number | null;
  available: boolean;
  isPinned: boolean;
}

interface Candidate {
  store: string;
  productName: string;
  refId: string | null;
  price: number;
  priceNet: number;
  available: boolean;
  url: string | null;
}

export default function MaterialOffersDrawer({
  material,
  onClose,
  onChanged,
}: {
  material: {
    id: string;
    name: string;
    unit: string;
    netPrice: number;
    referenceLink?: string | null;
  };
  onClose: () => void;
  onChanged: () => void;
}) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loadingOffers, setLoadingOffers] = useState(true);
  const [busyOfferId, setBusyOfferId] = useState<string | null>(null);

  // Búsqueda en vivo
  const [searchStore, setSearchStore] = useState(SEARCHABLE_STORES[0].key);
  const [searchQuery, setSearchQuery] = useState(
    searchHintFromName(material.name)
  );
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [addingUrl, setAddingUrl] = useState<string | null>(null);

  // Precio / link manual (fallback para tiendas sin búsqueda en vivo)
  const [manualOpen, setManualOpen] = useState(false);
  const [netPrice, setNetPrice] = useState(material.netPrice);
  const [referenceLink, setReferenceLink] = useState(
    material.referenceLink || ""
  );
  const [savingManual, setSavingManual] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);

  const loadOffers = useCallback(async () => {
    setLoadingOffers(true);
    try {
      const res = await fetch(
        `/api/catalogo/materiales/${material.id}/ofertas`
      );
      const data = await res.json();
      setOffers(Array.isArray(data) ? data : []);
    } catch {
      setOffers([]);
    } finally {
      setLoadingOffers(false);
    }
  }, [material.id]);

  useEffect(() => {
    loadOffers();
  }, [loadOffers]);

  // Marca una oferta ya guardada como la oficial del catálogo.
  async function pinOffer(offerId: string) {
    setBusyOfferId(offerId);
    await fetch(`/api/catalogo/materiales/${material.id}/ofertas/${offerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPinned: true }),
    });
    await loadOffers();
    onChanged();
    setBusyOfferId(null);
  }

  async function deleteOffer(offerId: string) {
    setBusyOfferId(offerId);
    await fetch(`/api/catalogo/materiales/${material.id}/ofertas/${offerId}`, {
      method: "DELETE",
    });
    await loadOffers();
    onChanged();
    setBusyOfferId(null);
  }

  async function runSearch() {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    setCandidates(null);
    try {
      const res = await fetch("/api/catalogo/buscar-precio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store: searchStore, query: q }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data.error || "No se pudo buscar");
      } else {
        setCandidates(data.products || []);
      }
    } catch {
      setSearchError("Error de red al buscar");
    } finally {
      setSearching(false);
    }
  }

  // Guarda un candidato de la búsqueda como oferta. pin=true lo vuelve oficial.
  async function addCandidate(c: Candidate, pin: boolean) {
    setAddingUrl(c.url || c.productName);
    await fetch(`/api/catalogo/materiales/${material.id}/ofertas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        store: c.store,
        productName: c.productName,
        productUrl: c.url,
        price: c.price,
        priceNet: c.priceNet,
        available: c.available,
        isPinned: pin,
        notes: c.refId ? `RefId ${c.refId}` : null,
      }),
    });
    await loadOffers();
    onChanged();
    setAddingUrl(null);
  }

  async function fetchFromLink() {
    const url = referenceLink.trim();
    if (!url) return;
    setFetching(true);
    setFetchResult(null);
    try {
      const res = await fetch("/api/catalogo/fetch-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFetchResult({ ok: false, msg: data.error || "Error desconocido" });
      } else {
        setNetPrice(data.netPrice);
        setFetchResult({ ok: true, msg: `Precio obtenido desde ${data.source}` });
      }
    } catch {
      setFetchResult({ ok: false, msg: "Error de red al consultar el link" });
    } finally {
      setFetching(false);
    }
  }

  async function saveManual() {
    setSavingManual(true);
    await fetch(`/api/catalogo/materiales/${material.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: material.name,
        unit: material.unit,
        netPrice,
        referenceLink: referenceLink || null,
      }),
    });
    await loadOffers();
    onChanged();
    setSavingManual(false);
  }

  const manualDirty =
    netPrice !== material.netPrice ||
    (referenceLink || "") !== (material.referenceLink || "");

  const linkIsFetchable =
    referenceLink &&
    ["sodimac", "easy", "mk.cl"].some((s) =>
      referenceLink.toLowerCase().includes(s)
    );

  return (
    <div
      className="fixed inset-0 bg-black/30 z-50 flex justify-end"
      onClick={onClose}
    >
      <div
        className="w-[520px] max-w-full bg-white h-full overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {material.name}
            </h2>
            <p className="text-sm text-gray-500">Unidad: {material.unit}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Cerrar"
          >
            <IconX className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Precio actual */}
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">
              Precio actual en catálogo
            </p>
            <p className="text-2xl font-bold text-gray-900 tabular-nums">
              {formatCLP(material.netPrice)}{" "}
              <span className="text-sm font-normal text-gray-500">neto</span>
            </p>
            <p className="text-sm text-gray-500 mt-0.5 tabular-nums">
              {formatCLP(Math.round(material.netPrice * 1.19))} c/IVA
            </p>
          </div>

          {/* Ofertas guardadas */}
          <section>
            <h3 className="text-sm font-medium text-gray-900 mb-2">
              Ofertas guardadas
            </h3>
            {loadingOffers ? (
              <p className="text-xs text-gray-400">Cargando…</p>
            ) : offers.length === 0 ? (
              <p className="text-xs text-gray-400">
                Todavía no hay ofertas guardadas. Buscá abajo para agregar una.
              </p>
            ) : (
              <ul className="space-y-2">
                {offers.map((o) => (
                  <li
                    key={o.id}
                    className={`rounded-xl border p-3 ${
                      o.isPinned
                        ? "border-gray-900"
                        : "border-gray-200"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                            {storeLabel(o.store)}
                          </span>
                          {o.isPinned && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-900 border border-gray-900 rounded-full px-1.5 py-0.5">
                              Oficial
                            </span>
                          )}
                          {o.available ? (
                            <span className="text-[10px] text-green-700">
                              con stock
                            </span>
                          ) : (
                            <span className="text-[10px] text-red-600">
                              sin stock
                            </span>
                          )}
                        </div>
                        <p
                          className="text-sm text-gray-800 truncate"
                          title={o.productName}
                        >
                          {o.productName}
                        </p>
                        <p className="text-sm text-gray-900 tabular-nums">
                          {formatCLP(o.priceNet ?? Math.round(o.price / 1.19))}{" "}
                          <span className="text-xs text-gray-400">neto</span>
                          <span className="text-xs text-gray-400">
                            {" "}
                            · {formatCLP(o.price)} c/IVA
                          </span>
                        </p>
                        {o.productUrl && (
                          <a
                            href={o.productUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 mt-1"
                          >
                            Ver en la tienda
                            <IconExternal className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        {!o.isPinned && (
                          <button
                            onClick={() => pinOffer(o.id)}
                            disabled={busyOfferId === o.id}
                            className="inline-flex items-center gap-1 text-xs border border-gray-300 rounded px-2 py-1 hover:bg-gray-50 disabled:opacity-50"
                          >
                            <IconStar className="w-3 h-3" />
                            Usar esta
                          </button>
                        )}
                        <button
                          onClick={() => deleteOffer(o.id)}
                          disabled={busyOfferId === o.id}
                          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
                        >
                          <IconTrash className="w-3 h-3" />
                          Borrar
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Buscar precio actual en la tienda */}
          <section>
            <h3 className="text-sm font-medium text-gray-900 mb-2">
              Buscar precio actual
            </h3>
            <div className="flex gap-2">
              <select
                value={searchStore}
                onChange={(e) => setSearchStore(e.target.value)}
                className="border border-gray-300 rounded px-2 py-2 text-sm"
              >
                {SEARCHABLE_STORES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                placeholder="Ej: guardapolvo foliado 15x90"
                className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
              />
              <button
                onClick={runSearch}
                disabled={searching}
                className="inline-flex items-center gap-1 bg-gray-900 text-white rounded px-3 py-2 text-sm hover:bg-gray-700 disabled:opacity-50"
              >
                {searching ? (
                  <IconSpinner className="w-4 h-4" />
                ) : (
                  <IconSearch className="w-4 h-4" />
                )}
                Buscar
              </button>
            </div>

            {searchError && (
              <p className="mt-2 text-xs text-red-600 bg-red-50 rounded px-2 py-1">
                {searchError}
              </p>
            )}

            {candidates && candidates.length === 0 && !searchError && (
              <p className="mt-2 text-xs text-gray-400">
                Sin resultados. Probá con menos palabras o términos más
                generales (ej: familia y medida principal, sin el largo).
              </p>
            )}

            {candidates && candidates.length > 0 && (
              <ul className="mt-3 space-y-2">
                {candidates.map((c) => {
                  const busy = addingUrl === (c.url || c.productName);
                  return (
                    <li
                      key={(c.url || c.productName) + c.price}
                      className="rounded-xl border border-gray-200 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                              {storeLabel(c.store)}
                            </span>
                            {c.available ? (
                              <span className="text-[10px] text-green-700">
                                con stock
                              </span>
                            ) : (
                              <span className="text-[10px] text-red-600">
                                sin stock
                              </span>
                            )}
                          </div>
                          <p
                            className="text-sm text-gray-800 truncate"
                            title={c.productName}
                          >
                            {c.productName}
                          </p>
                          <p className="text-sm text-gray-900 tabular-nums">
                            {formatCLP(c.priceNet)}{" "}
                            <span className="text-xs text-gray-400">neto</span>
                            <span className="text-xs text-gray-400">
                              {" "}
                              · {formatCLP(c.price)} c/IVA
                            </span>
                          </p>
                          {c.url && (
                            <a
                              href={c.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 mt-1"
                            >
                              Ver en la tienda
                              <IconExternal className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <button
                            onClick={() => addCandidate(c, true)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 text-xs bg-gray-900 text-white rounded px-2 py-1 hover:bg-gray-700 disabled:opacity-50"
                          >
                            {busy ? (
                              <IconSpinner className="w-3 h-3" />
                            ) : (
                              <IconCheck className="w-3 h-3" />
                            )}
                            Usar
                          </button>
                          <button
                            onClick={() => addCandidate(c, false)}
                            disabled={busy}
                            className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50"
                          >
                            Solo guardar
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Precio / link manual (fallback) */}
          <section className="border-t border-gray-200 pt-4">
            <button
              onClick={() => setManualOpen((v) => !v)}
              className="text-sm font-medium text-gray-900"
            >
              {manualOpen ? "− " : "+ "}
              Precio o link manual
            </button>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Para tiendas sin búsqueda en vivo (Sodimac, Easy) o para escribir
              el precio a mano.
            </p>

            {manualOpen && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">
                    Precio neto (sin IVA)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={netPrice || ""}
                      onChange={(e) =>
                        setNetPrice(parseFloat(e.target.value) || 0)
                      }
                      onFocus={(e) => e.currentTarget.select()}
                      className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
                      placeholder="Ej: 8395"
                    />
                    <span className="text-xs text-gray-500 whitespace-nowrap tabular-nums">
                      → {formatCLP(Math.round((netPrice || 0) * 1.19))} c/IVA
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">
                    Si tenés el precio con IVA, dividí por 1,19.
                  </p>
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">
                    Link de referencia
                  </label>
                  <input
                    type="url"
                    value={referenceLink}
                    onChange={(e) => {
                      setReferenceLink(e.target.value);
                      setFetchResult(null);
                    }}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                    placeholder="https://www.sodimac.cl/..."
                  />
                  {linkIsFetchable && (
                    <button
                      onClick={fetchFromLink}
                      disabled={fetching}
                      className="mt-2 w-full py-2 rounded text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {fetching
                        ? "Obteniendo precio…"
                        : "Obtener precio desde el link"}
                    </button>
                  )}
                  {fetchResult && (
                    <p
                      className={`mt-1.5 text-xs px-2 py-1 rounded ${
                        fetchResult.ok
                          ? "bg-green-50 text-green-700"
                          : "bg-red-50 text-red-600"
                      }`}
                    >
                      {fetchResult.msg}
                    </p>
                  )}
                </div>

                <button
                  onClick={saveManual}
                  disabled={!manualDirty || savingManual}
                  className={`w-full py-2 rounded text-sm font-medium ${
                    manualDirty
                      ? "bg-gray-900 text-white hover:bg-gray-700"
                      : "bg-gray-100 text-gray-400 cursor-not-allowed"
                  }`}
                >
                  {savingManual ? "Guardando…" : "Guardar precio manual"}
                </button>
              </div>
            )}
          </section>

          {/* Nota */}
          <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
            <strong>Nota:</strong> este precio se usa como referencia para
            futuros presupuestos. Los presupuestos ya aprobados mantienen sus
            precios originales.
          </div>
        </div>
      </div>
    </div>
  );
}
