"use client";

import { useState, useEffect } from "react";
import { formatCLP } from "@/lib/utils";

interface Component {
  id: string;
  type: string;
  description: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  referenceLink: string | null;
}

interface Partida {
  id: string;
  category: string;
  name: string;
  unit: string;
  unitPrice: number;
  costMaterial: number;
  costLabor: number;
  costTools: number;
  costMargin: number;
  costLoss: number;
  costSubcontract: number;
  components: Component[];
}

const TYPE_LABELS: Record<string, string> = {
  material: "Material",
  mano_obra: "Mano de Obra",
  margen: "Margen",
  herramientas: "Herramientas",
  subcontrato: "Subcontrato",
  perdida: "Pérdida",
};

const TYPE_COLORS: Record<string, string> = {
  material: "bg-blue-100 text-blue-800",
  mano_obra: "bg-green-100 text-green-800",
  margen: "bg-purple-100 text-purple-800",
  herramientas: "bg-yellow-100 text-yellow-800",
  subcontrato: "bg-orange-100 text-orange-800",
  perdida: "bg-red-100 text-red-800",
};

export default function PartidaSearch({
  categories,
}: {
  categories: string[];
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [partidas, setPartidas] = useState<Partida[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPartidas();
    }, 300);
    return () => clearTimeout(timer);
  }, [query, category]);

  async function fetchPartidas() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (category) params.set("category", category);
      params.set("limit", "100");

      const res = await fetch(`/api/catalogo/partidas?${params}`);
      const data = await res.json();
      setPartidas(data);
    } catch {
      console.error("Error fetching");
    } finally {
      setLoading(false);
    }
  }

  // Group by category
  const grouped = categories
    .filter((cat) => !category || cat === category)
    .map((cat) => ({
      category: cat,
      items: partidas.filter((p) => p.category === cat),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <div className="flex gap-4">
        <div className="flex-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar partida... (ej: demolicion, tabique, enchape)"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-4 py-3 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
        >
          <option value="">Todas las categorias</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <p className="text-gray-500 text-sm">Buscando...</p>
      )}

      {/* Results */}
      {grouped.map((group) => (
        <div
          key={group.category}
          className="bg-white rounded-xl border border-gray-200 overflow-hidden"
        >
          <div className="p-4 bg-gray-50 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">
              {group.category}{" "}
              <span className="text-gray-400 font-normal">
                ({group.items.length})
              </span>
            </h3>
          </div>
          <div className="divide-y divide-gray-50">
            {group.items.map((partida) => (
              <div key={partida.id}>
                <button
                  onClick={() =>
                    setExpanded(
                      expanded === partida.id ? null : partida.id
                    )
                  }
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-900">
                      {partida.name}
                    </span>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                      {partida.unit}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-medium text-gray-900">
                      {formatCLP(partida.unitPrice)}/{partida.unit}
                    </span>
                    <span className="text-gray-400 text-xs">
                      {expanded === partida.id ? "▲" : "▼"}
                    </span>
                  </div>
                </button>

                {/* Expanded detail */}
                {expanded === partida.id && (
                  <div className="px-4 pb-4 bg-gray-50">
                    {/* Cost breakdown */}
                    <div className="grid grid-cols-3 gap-3 mb-3">
                      {partida.costMaterial > 0 && (
                        <div className="text-xs">
                          <span className="text-gray-500">Material:</span>{" "}
                          <span className="font-medium">
                            {formatCLP(partida.costMaterial)}
                          </span>
                        </div>
                      )}
                      {partida.costLabor > 0 && (
                        <div className="text-xs">
                          <span className="text-gray-500">Mano Obra:</span>{" "}
                          <span className="font-medium">
                            {formatCLP(partida.costLabor)}
                          </span>
                        </div>
                      )}
                      {partida.costMargin > 0 && (
                        <div className="text-xs">
                          <span className="text-gray-500">Margen:</span>{" "}
                          <span className="font-medium">
                            {formatCLP(partida.costMargin)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Components */}
                    {partida.components.length > 0 && (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="text-left py-1 px-2 text-gray-500">
                              Tipo
                            </th>
                            <th className="text-left py-1 px-2 text-gray-500">
                              Descripcion
                            </th>
                            <th className="text-left py-1 px-2 text-gray-500">
                              Unidad
                            </th>
                            <th className="text-right py-1 px-2 text-gray-500">
                              Cant.
                            </th>
                            <th className="text-right py-1 px-2 text-gray-500">
                              Costo
                            </th>
                            <th className="text-right py-1 px-2 text-gray-500">
                              Total
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {partida.components.map((comp) => (
                            <tr
                              key={comp.id}
                              className="border-b border-gray-50"
                            >
                              <td className="py-1 px-2">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-xs ${
                                    TYPE_COLORS[comp.type] || "bg-gray-100"
                                  }`}
                                >
                                  {TYPE_LABELS[comp.type] || comp.type}
                                </span>
                              </td>
                              <td className="py-1 px-2 text-gray-900">
                                {comp.description}
                                {comp.referenceLink && (
                                  <a
                                    href={comp.referenceLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ml-1 text-blue-500"
                                  >
                                    ↗
                                  </a>
                                )}
                              </td>
                              <td className="py-1 px-2 text-gray-500">
                                {comp.unit}
                              </td>
                              <td className="py-1 px-2 text-right text-gray-600">
                                {comp.quantity}
                              </td>
                              <td className="py-1 px-2 text-right text-gray-600">
                                {formatCLP(comp.unitCost)}
                              </td>
                              <td className="py-1 px-2 text-right font-medium text-gray-900">
                                {formatCLP(comp.totalCost)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {!loading && partidas.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          No se encontraron partidas
        </div>
      )}
    </div>
  );
}
