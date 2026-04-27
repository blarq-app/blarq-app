"use client";

import { useState } from "react";
import { formatCLP } from "@/lib/utils";

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
  const [netPrice, setNetPrice] = useState(material.netPrice);
  const [referenceLink, setReferenceLink] = useState(
    material.referenceLink || ""
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState<{
    ok: boolean;
    msg: string;
    priceIva?: number;
  } | null>(null);

  async function fetchPriceFromLink() {
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
        setFetchResult({
          ok: true,
          msg: `Precio obtenido desde ${data.source}`,
          priceIva: data.priceIva,
        });
      }
    } catch {
      setFetchResult({ ok: false, msg: "Error de red al consultar el link" });
    } finally {
      setFetching(false);
    }
  }

  async function save() {
    setSaving(true);
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
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onChanged();
  }

  const dirty =
    netPrice !== material.netPrice ||
    (referenceLink || "") !== (material.referenceLink || "");

  return (
    <div
      className="fixed inset-0 bg-black/30 z-50 flex justify-end"
      onClick={onClose}
    >
      <div
        className="w-[480px] max-w-full bg-white h-full overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {material.name}
            </h2>
            <p className="text-sm text-gray-500">Unidad: {material.unit}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg"
          >
            ✕
          </button>
        </div>

        {/* Precio actual */}
        <div className="bg-gray-50 rounded-xl p-4 mb-6">
          <p className="text-xs text-gray-500 mb-1">Precio actual en catálogo</p>
          <p className="text-2xl font-bold text-gray-900">
            {formatCLP(material.netPrice)}{" "}
            <span className="text-sm font-normal text-gray-500">neto</span>
          </p>
          <p className="text-sm text-gray-500 mt-0.5">
            {formatCLP(Math.round(material.netPrice * 1.19))} c/IVA
          </p>
          {material.referenceLink && (
            <a
              href={material.referenceLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline mt-2 inline-block"
            >
              Ver referencia ↗
            </a>
          )}
        </div>

        {/* Formulario de actualización */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-gray-900">
            Actualizar precio
          </h3>

          <div>
            <label className="text-xs text-gray-500 block mb-1">
              Precio neto (sin IVA)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={netPrice || ""}
                onChange={(e) => setNetPrice(parseFloat(e.target.value) || 0)}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
                placeholder="Ej: 97471"
              />
              <span className="text-xs text-gray-500 whitespace-nowrap">
                → {formatCLP(Math.round((netPrice || 0) * 1.19))} c/IVA
              </span>
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              Si tienes el precio con IVA, divide por 1,19
            </p>
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">
              Link de referencia (Sodimac, Easy, etc.)
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
            {referenceLink &&
              (referenceLink.includes("sodimac") ||
                referenceLink.includes("easy")) && (
                <button
                  onClick={fetchPriceFromLink}
                  disabled={fetching}
                  className="mt-2 w-full py-2 rounded text-sm font-medium border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 transition-colors"
                >
                  {fetching ? "Obteniendo precio..." : "↓ Obtener precio desde el link"}
                </button>
              )}
            {fetchResult && (
              <p
                className={`mt-1.5 text-xs px-2 py-1 rounded ${
                  fetchResult.ok
                    ? "bg-green-50 text-green-700"
                    : "bg-red-50 text-red-700"
                }`}
              >
                {fetchResult.ok ? "✓ " : "✕ "}
                {fetchResult.msg}
                {fetchResult.priceIva && (
                  <span className="ml-1 text-green-600">
                    ({formatCLP(fetchResult.priceIva)} c/IVA)
                  </span>
                )}
              </p>
            )}
          </div>

          <button
            onClick={save}
            disabled={!dirty || saving}
            className={`w-full py-2 rounded text-sm font-medium transition-colors ${
              saved
                ? "bg-green-600 text-white"
                : dirty
                ? "bg-gray-900 text-white hover:bg-gray-700"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            {saved ? "✓ Guardado" : saving ? "Guardando..." : "Guardar precio"}
          </button>
        </div>

        {/* Info */}
        <div className="mt-8 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
          <strong>Nota:</strong> Este precio se usa como referencia para futuros
          presupuestos. Los presupuestos ya aprobados mantienen sus precios
          originales.
        </div>
      </div>
    </div>
  );
}
