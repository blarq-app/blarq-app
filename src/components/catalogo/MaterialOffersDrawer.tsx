"use client";

import { useEffect, useState } from "react";
import { formatCLP } from "@/lib/utils";

const STORES = [
  { value: "sodimac", label: "Sodimac" },
  { value: "easy", label: "Easy" },
  { value: "construmart", label: "Construmart" },
  { value: "mercadolibre", label: "MercadoLibre" },
  { value: "imperial", label: "Imperial" },
  { value: "chilemat", label: "Chilemat" },
  { value: "otro", label: "Otro" },
];

type Offer = {
  id: string;
  store: string;
  productName: string;
  productUrl: string | null;
  price: number;
  priceNet: number | null;
  available: boolean;
  isPinned: boolean;
  notes: string | null;
  checkedAt: string;
};

export default function MaterialOffersDrawer({
  material,
  onClose,
  onChanged,
}: {
  material: { id: string; name: string; unit: string; netPrice: number };
  onClose: () => void;
  onChanged: () => void;
}) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [newOffer, setNewOffer] = useState({
    store: "sodimac",
    productName: "",
    productUrl: "",
    price: 0,
  });

  useEffect(() => {
    fetch(`/api/catalogo/materiales/${material.id}/ofertas`)
      .then((r) => r.json())
      .then((d) => {
        setOffers(d);
        setLoading(false);
      });
  }, [material.id]);

  async function addOffer() {
    if (!newOffer.productName || !newOffer.price) return;
    const res = await fetch(
      `/api/catalogo/materiales/${material.id}/ofertas`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newOffer),
      }
    );
    const created = await res.json();
    setOffers([...offers, created]);
    setNewOffer({
      store: newOffer.store,
      productName: "",
      productUrl: "",
      price: 0,
    });
    onChanged();
  }

  async function updateOffer(offer: Offer, changes: Partial<Offer>) {
    const next = { ...offer, ...changes };
    setOffers((prev) => prev.map((o) => (o.id === offer.id ? next : o)));
    await fetch(
      `/api/catalogo/materiales/${material.id}/ofertas/${offer.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      }
    );
    if (changes.isPinned) {
      setOffers((prev) =>
        prev.map((o) => ({ ...o, isPinned: o.id === offer.id }))
      );
      onChanged();
    }
  }

  async function deleteOffer(id: string) {
    if (!confirm("Eliminar esta oferta?")) return;
    await fetch(`/api/catalogo/materiales/${material.id}/ofertas/${id}`, {
      method: "DELETE",
    });
    setOffers((prev) => prev.filter((o) => o.id !== id));
    onChanged();
  }

  const sorted = [...offers].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return a.price - b.price;
  });

  const cheapest = sorted.reduce(
    (min, o) => (o.available && o.price < (min?.price ?? Infinity) ? o : min),
    null as Offer | null
  );

  return (
    <div
      className="fixed inset-0 bg-black/30 z-50 flex justify-end"
      onClick={onClose}
    >
      <div
        className="w-[640px] max-w-full bg-white h-full overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {material.name}
            </h2>
            <p className="text-sm text-gray-500">
              Unidad: {material.unit} · Precio catálogo:{" "}
              {formatCLP(material.netPrice)} neto
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {cheapest && (
          <div className="bg-green-50 border border-green-200 rounded p-3 mb-4 text-sm">
            <span className="text-green-900 font-medium">Más barato: </span>
            <span className="text-green-800">
              {STORES.find((s) => s.value === cheapest.store)?.label} ·{" "}
              {formatCLP(cheapest.price)} c/IVA ·{" "}
              {formatCLP(cheapest.priceNet || cheapest.price / 1.19)} neto
            </span>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-gray-500">Cargando...</p>
        ) : (
          <div className="space-y-2 mb-6">
            {sorted.length === 0 && (
              <p className="text-sm text-gray-500 italic">
                Aún no hay ofertas registradas.
              </p>
            )}
            {sorted.map((o) => (
              <div
                key={o.id}
                className={`border rounded p-3 ${
                  o.isPinned
                    ? "border-blue-300 bg-blue-50"
                    : "border-gray-200"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium uppercase text-gray-500">
                      {STORES.find((s) => s.value === o.store)?.label || o.store}
                    </span>
                    {o.isPinned && (
                      <span className="text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded">
                        oficial
                      </span>
                    )}
                    {!o.available && (
                      <span className="text-[10px] bg-gray-400 text-white px-1.5 py-0.5 rounded">
                        sin stock
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!o.isPinned && (
                      <button
                        onClick={() => updateOffer(o, { isPinned: true })}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Usar como oficial
                      </button>
                    )}
                    <button
                      onClick={() => deleteOffer(o.id)}
                      className="text-xs text-gray-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="mt-1 text-sm text-gray-900">{o.productName}</div>
                <div className="mt-1 flex items-center gap-4 text-sm">
                  <span className="font-semibold">{formatCLP(o.price)}</span>
                  <span className="text-gray-500 text-xs">
                    neto {formatCLP(o.priceNet || o.price / 1.19)}
                  </span>
                  {o.productUrl && (
                    <a
                      href={o.productUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Ver en tienda ↗
                    </a>
                  )}
                </div>
                {o.notes && (
                  <div className="mt-1 text-xs text-gray-500">{o.notes}</div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-gray-200 pt-4">
          <h3 className="text-sm font-medium text-gray-900 mb-2">
            Agregar oferta
          </h3>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <select
              value={newOffer.store}
              onChange={(e) =>
                setNewOffer({ ...newOffer, store: e.target.value })
              }
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              {STORES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              placeholder="Precio c/IVA"
              value={newOffer.price || ""}
              onChange={(e) =>
                setNewOffer({
                  ...newOffer,
                  price: parseFloat(e.target.value) || 0,
                })
              }
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </div>
          <input
            type="text"
            placeholder="Nombre del producto en la tienda"
            value={newOffer.productName}
            onChange={(e) =>
              setNewOffer({ ...newOffer, productName: e.target.value })
            }
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm mb-2"
          />
          <input
            type="url"
            placeholder="URL del producto (opcional)"
            value={newOffer.productUrl}
            onChange={(e) =>
              setNewOffer({ ...newOffer, productUrl: e.target.value })
            }
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm mb-2"
          />
          <button
            onClick={addOffer}
            disabled={!newOffer.productName || !newOffer.price}
            className="bg-gray-900 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            Agregar
          </button>
        </div>
      </div>
    </div>
  );
}
