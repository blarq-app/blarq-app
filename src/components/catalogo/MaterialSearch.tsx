"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import { useSearchParams } from "next/navigation";
import { formatCLP } from "@/lib/utils";
import MaterialOffersDrawer from "./MaterialOffersDrawer";
import BulkPriceUpdateModal from "./BulkPriceUpdateModal";

// Tiendas de las que la app sabe leer el precio actual desde el link guardado
// (mismo criterio que usa el panel de Precios). Solo en estas mostramos el
// botón "Actualizar", porque para Sodimac/Easy/mK existe scraping; para el
// resto el link es solo de referencia y no se puede leer el precio automático.
function isFetchableLink(link: string | null): boolean {
  if (!link) return false;
  const l = link.toLowerCase();
  return ["sodimac", "easy", "mk.cl"].some((s) => l.includes(s));
}

interface Material {
  id: string;
  category: string;
  name: string;
  unit: string;
  netPrice: number;
  isProvision: boolean;
  referenceLink: string | null;
}

const UNITS = ["UN", "M2", "ML", "M3", "KG", "GL", "LT", "ROLLO", "SACO"];

export default function MaterialSearch({
  categories,
}: {
  categories: string[];
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(false);

  // Add material state
  const [addingCategory, setAddingCategory] = useState<string | null>(null);
  const [newMat, setNewMat] = useState({
    name: "",
    unit: "UN",
    netPrice: 0,
    referenceLink: "",
  });
  const [saving, setSaving] = useState(false);

  // Alta desde link: trae nombre + precio del producto al pegar el link.
  // - extracting: hay una lectura en curso ("Buscando…").
  // - extractNote: aviso discreto del resultado (sin datos / error). Si la
  //   lectura va bien no mostramos nada: los campos quedan rellenos y listos.
  const [extracting, setExtracting] = useState(false);
  const [extractNote, setExtractNote] = useState<string | null>(null);

  // Edit material state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMat, setEditMat] = useState({
    name: "",
    unit: "UN",
    netPrice: 0,
    referenceLink: "",
  });

  // New category state
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  // Offers drawer
  const [offersMaterial, setOffersMaterial] = useState<Material | null>(null);

  // Actualizar precio desde el link guardado (botón ↻ por fila).
  // - refreshingId: fila con request en curso (revisando o guardando).
  // - refreshPreview: precio nuevo distinto, a la espera de confirmación.
  // - refreshNote: aviso de "sin cambios" o de error para esa fila.
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [refreshPreview, setRefreshPreview] = useState<{
    id: string;
    oldNet: number;
    newNet: number;
    source: string;
  } | null>(null);
  const [refreshNote, setRefreshNote] = useState<{
    id: string;
    kind: "same" | "error";
    msg: string;
  } | null>(null);

  // Modal "Actualizar todos los precios"
  const [bulkOpen, setBulkOpen] = useState(false);

  // Foco desde el catálogo de partidas: cuando se llega con ?focus=<id>
  // (al apretar el nombre de un material en el desglose de una partida),
  // abrimos ese material en modo edición, hacemos scroll a su fila y la
  // resaltamos un par de segundos para ubicarla.
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus");
  const handledFocusRef = useRef<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => fetchMaterials(), 300);
    return () => clearTimeout(timer);
  }, [query, category]);

  useEffect(() => {
    if (!focusId || handledFocusRef.current === focusId || materials.length === 0)
      return;
    const mat = materials.find((m) => m.id === focusId);
    if (!mat) return;
    handledFocusRef.current = focusId;
    startEdit(mat);
    setHighlightId(mat.id);
  }, [focusId, materials]);

  // El scroll va en su propio effect, disparado cuando highlightId ya quedó
  // seteado: para entonces la fila en modo edición ya está montada en el DOM,
  // así que scrollIntoView la encuentra (hacerlo en el effect de arriba con un
  // setTimeout era racy y a veces no centraba nada). El resaltado se apaga solo.
  useEffect(() => {
    if (!highlightId) return;
    // Scroll instantáneo (no "smooth"): la animación del smooth se cancela en
    // cuanto hay un re-render durante el medio segundo que dura, y el listado
    // se está montando/refetcheando justo entonces, así que nunca llegaba a
    // destino. El salto directo es inmediato y queda firme.
    const scrollToRow = () =>
      document
        .getElementById(`mat-${highlightId}`)
        ?.scrollIntoView({ block: "center" });
    scrollToRow();
    // Segundo intento diferido por si un refetch tardío (StrictMode en dev)
    // re-monta el listado y resetea el scroll. En prod es un no-op.
    const reT = setTimeout(scrollToRow, 500);
    const fadeT = setTimeout(() => setHighlightId(null), 2500);
    return () => {
      clearTimeout(reT);
      clearTimeout(fadeT);
    };
  }, [highlightId]);

  async function fetchMaterials() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (category) params.set("category", category);
      params.set("limit", "500");
      const res = await fetch(`/api/catalogo/materiales?${params}`);
      setMaterials(await res.json());
    } catch {
      console.error("Error");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddMaterial(cat: string) {
    if (!newMat.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/catalogo/materiales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newMat, category: cat }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Error al crear material");
        return;
      }
      const created = await res.json();
      setMaterials([...materials, created]);
      setNewMat({ name: "", unit: "UN", netPrice: 0, referenceLink: "" });
      setExtractNote(null);
      setAddingCategory(null);
    } catch {
      alert("Error al crear material");
    } finally {
      setSaving(false);
    }
  }

  // Lee el producto desde el link pegado y rellena nombre + precio del form
  // de alta. No pisa lo que MJ ya escribió: solo completa lo que esté vacío,
  // y todo queda editable para que valide antes de guardar. Si no se pudo
  // leer, deja un aviso discreto y MJ completa a mano (nunca inventa precio).
  async function extractFromLink() {
    const link = newMat.referenceLink.trim();
    if (!link) {
      setExtractNote("Pegá un link primero.");
      return;
    }
    setExtracting(true);
    setExtractNote(null);
    try {
      const res = await fetch(
        `/api/catalogo/materiales/extract?url=${encodeURIComponent(link)}`
      );
      const data = await res.json();
      if (!res.ok) {
        setExtractNote(data.error || "No se pudo leer, completá a mano.");
        return;
      }
      setNewMat((prev) => ({
        ...prev,
        // Nombre en MAYÚSCULA para igualar la convención del catálogo. Queda
        // editable: si MJ ya había escrito algo, no lo pisamos.
        name:
          !prev.name.trim() && data.name
            ? String(data.name).toUpperCase()
            : prev.name,
        netPrice: !prev.netPrice && data.netPrice ? data.netPrice : prev.netPrice,
      }));
      // Si vino precio pero no nombre (o viceversa), avisamos qué falta.
      if (!data.name && data.netPrice === null) {
        setExtractNote("No se pudo leer, completá a mano.");
      } else if (!data.name) {
        setExtractNote("Traje el precio; el nombre completalo a mano.");
      } else if (data.netPrice === null) {
        setExtractNote("Traje el nombre; el precio completalo a mano.");
      }
    } catch {
      setExtractNote("No se pudo leer, completá a mano.");
    } finally {
      setExtracting(false);
    }
  }

  async function handleUpdateMaterial(id: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/catalogo/materiales/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editMat),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setMaterials(materials.map((m) => (m.id === id ? updated : m)));
      setEditingId(null);
    } catch {
      alert("Error al actualizar material");
    } finally {
      setSaving(false);
    }
  }

  // Revisa el precio actual en la tienda usando el link YA guardado del
  // material. No guarda nada: si cambió, deja un preview a confirmar; si es
  // igual o falla, deja un aviso en la fila.
  async function refreshPriceFromLink(mat: Material) {
    if (!mat.referenceLink) return;
    setRefreshingId(mat.id);
    setRefreshPreview(null);
    setRefreshNote(null);
    try {
      const res = await fetch("/api/catalogo/fetch-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: mat.referenceLink }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRefreshNote({
          id: mat.id,
          kind: "error",
          msg: data.error || "No se pudo obtener el precio",
        });
        return;
      }
      const newNet = Math.round(data.netPrice);
      if (newNet === mat.netPrice) {
        setRefreshNote({
          id: mat.id,
          kind: "same",
          msg: `Sin cambios (${data.source}): sigue en ${formatCLP(newNet)} neto`,
        });
      } else {
        setRefreshPreview({
          id: mat.id,
          oldNet: mat.netPrice,
          newNet,
          source: data.source,
        });
      }
    } catch {
      setRefreshNote({
        id: mat.id,
        kind: "error",
        msg: "Error de red al consultar el link",
      });
    } finally {
      setRefreshingId(null);
    }
  }

  // Confirma el precio nuevo: lo guarda en el material (mismo PUT que la
  // edición manual; respeta nombre, unidad y link).
  async function applyRefresh(mat: Material, newNet: number) {
    setRefreshingId(mat.id);
    try {
      const res = await fetch(`/api/catalogo/materiales/${mat.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: mat.name,
          unit: mat.unit,
          netPrice: newNet,
          referenceLink: mat.referenceLink || null,
        }),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setMaterials((prev) => prev.map((m) => (m.id === mat.id ? updated : m)));
      setRefreshPreview(null);
    } catch {
      setRefreshNote({
        id: mat.id,
        kind: "error",
        msg: "No se pudo guardar el precio nuevo",
      });
    } finally {
      setRefreshingId(null);
    }
  }

  async function handleDeleteMaterial(id: string) {
    if (!confirm("Eliminar este material del catalogo?")) return;
    try {
      await fetch(`/api/catalogo/materiales/${id}`, { method: "DELETE" });
      setMaterials(materials.filter((m) => m.id !== id));
    } catch {
      alert("Error al eliminar material");
    }
  }

  function startEdit(mat: Material) {
    setEditingId(mat.id);
    setEditMat({
      name: mat.name,
      unit: mat.unit,
      netPrice: mat.netPrice,
      referenceLink: mat.referenceLink || "",
    });
  }

  // Get all categories (existing + from materials that might not be in the server list)
  const allCategories = [
    ...new Set([
      ...categories,
      ...materials.map((m) => m.category),
    ]),
  ].sort();

  const grouped = allCategories
    .filter((cat) => !category || cat === category)
    .map((cat) => ({
      category: cat,
      items: materials.filter((m) => m.category === cat),
    }))
    .filter((g) => g.items.length > 0 || addingCategory === g.category);

  return (
    <div className="space-y-6">
      <div className="flex gap-4">
        <div className="flex-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar material... (ej: yeso, pintura, tornillo)"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-4 py-3 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
        >
          <option value="">Todas las categorias</option>
          {allCategories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
        <button
          onClick={() => setBulkOpen(true)}
          className="px-4 py-3 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors whitespace-nowrap"
          title="Revisar el precio actual en la web de todos los materiales con link de Sodimac/Easy/mK"
        >
          ↻ Actualizar precios
        </button>
        <button
          onClick={() => setShowNewCategory(true)}
          className="px-4 py-3 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors whitespace-nowrap"
        >
          + Categoria
        </button>
      </div>

      {/* New category form */}
      {showNewCategory && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <h4 className="text-sm font-medium text-gray-900 mb-3">
            Nueva categoria
          </h4>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) =>
                  setNewCategoryName(e.target.value.toUpperCase())
                }
                placeholder="Nombre de la categoria (ej: PINTURAS)"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                autoFocus
              />
            </div>
            <button
              onClick={() => {
                if (!newCategoryName.trim()) return;
                setAddingCategory(newCategoryName.trim());
                setShowNewCategory(false);
                setNewCategoryName("");
              }}
              className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800"
            >
              Crear
            </button>
            <button
              onClick={() => {
                setShowNewCategory(false);
                setNewCategoryName("");
              }}
              className="text-gray-500 px-3 py-2 rounded-lg text-sm hover:bg-gray-200"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {grouped.map((group) => (
        <div
          key={group.category}
          className="bg-white rounded-xl border border-gray-200 overflow-hidden"
        >
          <div className="flex items-center justify-between p-4 bg-gray-50 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">
              {group.category}{" "}
              <span className="text-gray-400 font-normal">
                ({group.items.length})
              </span>
            </h3>
            <button
              onClick={() => {
                setAddingCategory(
                  addingCategory === group.category ? null : group.category
                );
                setNewMat({
                  name: "",
                  unit: "UN",
                  netPrice: 0,
                  referenceLink: "",
                });
                setExtractNote(null);
              }}
              className="text-sm text-gray-600 hover:text-gray-900 font-medium"
            >
              + Agregar
            </button>
          </div>

          {group.items.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-4 py-2 text-xs text-gray-500">
                    Material
                  </th>
                  <th className="text-left px-4 py-2 text-xs text-gray-500 w-20">
                    Unidad
                  </th>
                  <th className="text-right px-4 py-2 text-xs text-gray-500 w-32">
                    Precio Neto
                  </th>
                  <th className="text-right px-4 py-2 text-xs text-gray-500 w-32">
                    c/IVA
                  </th>
                  <th className="text-left px-4 py-2 text-xs text-gray-500 w-36">
                    Link
                  </th>
                  <th className="w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {group.items.map((mat) =>
                  editingId === mat.id ? (
                    <tr
                      key={mat.id}
                      id={`mat-${mat.id}`}
                      className={`bg-blue-50 ${
                        highlightId === mat.id ? "ring-2 ring-inset ring-gray-900" : ""
                      }`}
                    >
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={editMat.name}
                          onChange={(e) =>
                            setEditMat({ ...editMat, name: e.target.value })
                          }
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <select
                          value={editMat.unit}
                          onChange={(e) =>
                            setEditMat({ ...editMat, unit: e.target.value })
                          }
                          className="px-2 py-1 border border-gray-300 rounded text-sm bg-white focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                        >
                          {UNITS.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          step="1"
                          value={editMat.netPrice || ""}
                          onChange={(e) =>
                            setEditMat({
                              ...editMat,
                              netPrice: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-right focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                        />
                      </td>
                      <td className="px-4 py-2 text-right text-gray-400 text-sm">
                        {editMat.netPrice ? formatCLP(Math.round(editMat.netPrice * 1.19)) : "—"}
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="url"
                          value={editMat.referenceLink}
                          onChange={(e) =>
                            setEditMat({
                              ...editMat,
                              referenceLink: e.target.value,
                            })
                          }
                          placeholder="https://..."
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleUpdateMaterial(mat.id)}
                            disabled={saving}
                            className="text-green-600 hover:text-green-800 text-xs font-medium"
                          >
                            Guardar
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-gray-400 hover:text-gray-600 text-xs"
                          >
                            Cancelar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <Fragment key={mat.id}>
                    <tr
                      id={`mat-${mat.id}`}
                      className={`hover:bg-gray-50 group ${
                        highlightId === mat.id ? "ring-2 ring-inset ring-gray-900" : ""
                      }`}
                    >
                      <td className="px-4 py-2 text-gray-900">
                        <span>{mat.name}</span>
                        {mat.isProvision && (
                          <span className="ml-2 text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">
                            provisión
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-gray-500">{mat.unit}</td>
                      <td className="px-4 py-2 text-right font-medium">
                        {mat.netPrice > 0 ? formatCLP(mat.netPrice) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-400">
                        {mat.netPrice > 0 ? formatCLP(Math.round(mat.netPrice * 1.19)) : <span className="text-gray-200">—</span>}
                      </td>
                      <td className="px-4 py-2">
                        {mat.referenceLink && (
                          <a
                            href={mat.referenceLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:text-blue-700 text-xs"
                          >
                            Ver ↗
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          {isFetchableLink(mat.referenceLink) && (
                            <button
                              onClick={() => refreshPriceFromLink(mat)}
                              disabled={refreshingId === mat.id}
                              className="text-gray-500 hover:text-gray-900 text-xs disabled:opacity-50 whitespace-nowrap"
                              title="Revisar el precio actual en la tienda y actualizarlo"
                            >
                              {refreshingId === mat.id && refreshPreview?.id !== mat.id
                                ? "Revisando…"
                                : "↻ Actualizar"}
                            </button>
                          )}
                          {!mat.isProvision && (
                            <button
                              onClick={() => setOffersMaterial(mat)}
                              className="text-gray-500 hover:text-gray-900 text-xs"
                              title="Ver y actualizar precios"
                            >
                              Precios
                            </button>
                          )}
                          <button
                            onClick={() => startEdit(mat)}
                            className="text-gray-400 hover:text-gray-600 text-xs"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => handleDeleteMaterial(mat.id)}
                            className="text-gray-400 hover:text-red-500 text-xs"
                          >
                            x
                          </button>
                        </div>
                      </td>
                    </tr>
                    {/* Confirmación del precio nuevo: antes → después */}
                    {refreshPreview?.id === mat.id && (
                      <tr className="bg-amber-50">
                        <td colSpan={6} className="px-4 py-2">
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <div className="min-w-0">
                              <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500 mr-2">
                                {refreshPreview.source}
                              </span>
                              <span className="tabular-nums text-gray-500 line-through">
                                {formatCLP(refreshPreview.oldNet)}
                              </span>
                              <span className="mx-2 text-gray-400">→</span>
                              <span
                                className={`tabular-nums font-semibold ${
                                  refreshPreview.newNet > refreshPreview.oldNet
                                    ? "text-red-600"
                                    : "text-green-700"
                                }`}
                              >
                                {formatCLP(refreshPreview.newNet)}
                              </span>
                              <span className="text-xs text-gray-400 ml-1">neto</span>
                            </div>
                            <div className="flex gap-2 shrink-0">
                              <button
                                onClick={() => applyRefresh(mat, refreshPreview.newNet)}
                                disabled={refreshingId === mat.id}
                                className="bg-gray-900 text-white rounded px-3 py-1 text-xs hover:bg-gray-700 disabled:opacity-50"
                              >
                                {refreshingId === mat.id ? "Guardando…" : "Guardar precio"}
                              </button>
                              <button
                                onClick={() => setRefreshPreview(null)}
                                className="text-gray-500 hover:text-gray-800 text-xs px-2"
                              >
                                Descartar
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    {/* Aviso "sin cambios" o error */}
                    {refreshNote?.id === mat.id && (
                      <tr>
                        <td colSpan={6} className="px-4 pb-2 pt-0">
                          <span
                            className={`inline-block text-xs px-2 py-1 rounded ${
                              refreshNote.kind === "error"
                                ? "bg-red-50 text-red-600"
                                : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {refreshNote.msg}
                          </span>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                )}
              </tbody>
            </table>
          )}

          {/* Add material form. Pensado "link primero": MJ pega el link del
              producto (Sodimac / Easy / mK), aprieta "Traer del link" y se
              rellenan nombre y precio. Todo queda editable; si no se pudo leer
              completa a mano. */}
          {addingCategory === group.category && (
            <div className="p-4 border-t border-gray-100 bg-blue-50 space-y-3">
              {/* Fila 1: link + traer del link */}
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="block text-xs text-gray-600 mb-1">
                    Link del producto
                  </label>
                  <input
                    type="url"
                    value={newMat.referenceLink}
                    onChange={(e) => {
                      setNewMat({ ...newMat, referenceLink: e.target.value });
                      setExtractNote(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        extractFromLink();
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                    placeholder="https://mk.cl/... · https://sodimac.cl/... (opcional)"
                    autoFocus
                  />
                </div>
                <button
                  onClick={extractFromLink}
                  disabled={extracting || !newMat.referenceLink.trim()}
                  className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-100 disabled:opacity-50 whitespace-nowrap"
                  title="Leer nombre y precio desde el link"
                >
                  {extracting ? "Buscando…" : "Traer del link"}
                </button>
              </div>

              {extractNote && (
                <p className="text-xs text-gray-500">{extractNote}</p>
              )}

              {/* Fila 2: nombre + unidad + precio + acciones */}
              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-5">
                  <label className="block text-xs text-gray-600 mb-1">
                    Nombre
                  </label>
                  <input
                    type="text"
                    value={newMat.name}
                    onChange={(e) =>
                      setNewMat({ ...newMat, name: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                    placeholder="Nombre del material"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-600 mb-1">
                    Unidad
                  </label>
                  <select
                    value={newMat.unit}
                    onChange={(e) =>
                      setNewMat({ ...newMat, unit: e.target.value })
                    }
                    className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-600 mb-1">
                    Precio Neto
                  </label>
                  <input
                    type="number"
                    step="1"
                    value={newMat.netPrice || ""}
                    onChange={(e) =>
                      setNewMat({
                        ...newMat,
                        netPrice: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-right tabular-nums focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                    placeholder="$0"
                  />
                </div>
                <div className="col-span-3 flex gap-2">
                  <button
                    onClick={() => handleAddMaterial(group.category)}
                    disabled={saving || !newMat.name.trim()}
                    className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
                  >
                    {saving ? "..." : "Agregar"}
                  </button>
                  <button
                    onClick={() => {
                      setAddingCategory(null);
                      setExtractNote(null);
                    }}
                    className="text-gray-500 px-3 py-2 rounded-lg text-sm hover:bg-gray-200"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}

      {!loading && materials.length === 0 && !addingCategory && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          No se encontraron materiales
        </div>
      )}

      {offersMaterial && (
        <MaterialOffersDrawer
          material={offersMaterial}
          onClose={() => setOffersMaterial(null)}
          onChanged={() => fetchMaterials()}
        />
      )}

      {bulkOpen && (
        <BulkPriceUpdateModal
          materials={materials.filter(
            (m) => !m.isProvision && isFetchableLink(m.referenceLink)
          )}
          onClose={() => setBulkOpen(false)}
          onApplied={() => fetchMaterials()}
        />
      )}
    </div>
  );
}
