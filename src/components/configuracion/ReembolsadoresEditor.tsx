"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Alias = {
  id?: string;
  rut: string;
  businessName: string | null;
};

type Reembolsador = {
  id: string;
  nombre: string;
  glosa: string;
  // RUT de la persona en la transferencia (señal principal de match).
  personRut?: string | null;
  // Legacy single (todavia viene poblado para back-compat).
  rutAlias?: string | null;
  businessName?: string | null;
  aliases?: Alias[];
};

/**
 * Clases compartidas de los inputs de esta pantalla.
 *
 * `py-2 md:py-1.5` sube el alto táctil en el celular sin engordar el desktop.
 * El tamaño de letra no se toca acá: en el celular lo sube a 16px una regla de
 * globals.css (si no, Safari hace zoom al enfocar y no vuelve solo).
 */
const INPUT =
  "w-full px-3 py-2 md:py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-gray-900 focus:border-gray-900 outline-none";

export default function ReembolsadoresEditor({
  initial,
}: {
  initial: Reembolsador[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);

  // Form de creacion
  const [nombre, setNombre] = useState("");
  const [glosa, setGlosa] = useState("");
  const [personRut, setPersonRut] = useState("");
  const [newAliases, setNewAliases] = useState<Alias[]>([
    { rut: "", businessName: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // En el celular el form de creación arranca CERRADO. Ocupaba la pantalla
  // entera (3 campos + editor de alias + 2 párrafos de ayuda) y para ver la
  // lista de quiénes ya están cargados había que scrollear todo eso — cuando
  // lo normal es entrar a mirar, no a agregar. En desktop se muestra siempre.
  const [agregarAbierto, setAgregarAbierto] = useState(false);

  // Estado de edicion inline (id del item siendo editado)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState("");
  const [editGlosa, setEditGlosa] = useState("");
  const [editPersonRut, setEditPersonRut] = useState("");
  const [editAliases, setEditAliases] = useState<Alias[]>([]);

  function startEdit(r: Reembolsador) {
    setEditingId(r.id);
    setEditNombre(r.nombre);
    setEditGlosa(r.glosa);
    setEditPersonRut(r.personRut ?? "");
    // Si tiene aliases listados, usamos esos. Sino, intentamos backfill
    // desde el rutAlias legacy (un solo alias).
    const aliasesArr = r.aliases && r.aliases.length > 0
      ? r.aliases.map((a) => ({ id: a.id, rut: a.rut, businessName: a.businessName ?? "" }))
      : r.rutAlias
        ? [{ rut: r.rutAlias, businessName: r.businessName ?? "" }]
        : [];
    setEditAliases(aliasesArr.length > 0 ? aliasesArr : [{ rut: "", businessName: "" }]);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditNombre("");
    setEditGlosa("");
    setEditPersonRut("");
    setEditAliases([]);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nombre.trim() || !glosa.trim()) {
      setError("Nombre y glosa son obligatorios");
      return;
    }
    const cleanAliases = newAliases
      .map((a) => ({ rut: a.rut.trim(), businessName: a.businessName?.trim() || null }))
      .filter((a) => a.rut.length > 0);
    setBusy(true);
    try {
      const res = await fetch("/api/reembolsadores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nombre.trim(),
          glosa: glosa.trim(),
          personRut: personRut.trim() || null,
          aliases: cleanAliases,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Error al crear");
        return;
      }
      setItems((arr) =>
        [...arr, body].sort((a, b) => a.nombre.localeCompare(b.nombre))
      );
      setNombre("");
      setGlosa("");
      setPersonRut("");
      setNewAliases([{ rut: "", businessName: "" }]);
      setAgregarAbierto(false);
      router.refresh();
    } catch {
      setError("Error de red");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    setError(null);
    const cleanAliases = editAliases
      .map((a) => ({ rut: a.rut.trim(), businessName: a.businessName?.trim() || null }))
      .filter((a) => a.rut.length > 0);
    setBusy(true);
    try {
      const res = await fetch(`/api/reembolsadores/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: editNombre.trim(),
          glosa: editGlosa.trim(),
          personRut: editPersonRut.trim() || null,
          aliases: cleanAliases,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Error al guardar");
        return;
      }
      setItems((arr) =>
        arr
          .map((x) => (x.id === editingId ? body : x))
          .sort((a, b) => a.nombre.localeCompare(b.nombre))
      );
      cancelEdit();
      router.refresh();
    } catch {
      setError("Error de red");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Borrar este reembolsador?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/reembolsadores/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Error al borrar");
        return;
      }
      setItems((arr) => arr.filter((x) => x.id !== id));
      router.refresh();
    } catch {
      setError("Error de red");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Agregar ──────────────────────────────────────────────────────
          En mobile es un desplegable; en desktop (md+) el form va siempre
          abierto y el botón de arriba no se muestra. */}
      <div>
        <button
          type="button"
          onClick={() => setAgregarAbierto((v) => !v)}
          className="md:hidden w-full flex items-center justify-between min-h-12 px-4 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-900"
          aria-expanded={agregarAbierto}
        >
          Agregar reembolsador
          <span className="text-gray-400 text-lg leading-none">
            {agregarAbierto ? "−" : "+"}
          </span>
        </button>

        <form
          onSubmit={handleAdd}
          className={`${
            agregarAbierto ? "block mt-3" : "hidden"
          } md:block bg-white border border-gray-200 rounded-xl p-4 md:p-5 space-y-3`}
        >
          <p className="hidden md:block text-xs font-medium text-gray-500 uppercase tracking-wide">
            Agregar reembolsador
          </p>

          <CamposReembolsador
            valNombre={nombre}
            setValNombre={setNombre}
            valGlosa={glosa}
            setValGlosa={setGlosa}
            valRut={personRut}
            setValRut={setPersonRut}
            conPlaceholders

            disabled={busy}
          />

          <AliasListEditor
            aliases={newAliases}
            onChange={setNewAliases}
            disabled={busy}
          />

          {error && !editingId && <p className="text-xs text-red-700">{error}</p>}

          {/* w-full en mobile: el botón de acción principal se acierta con el
              pulgar sin apuntar. En desktop vuelve a ser chico y a la derecha. */}
          <div className="flex items-center justify-end pt-2 border-t border-gray-100">
            <button
              type="submit"
              disabled={busy}
              className="w-full md:w-auto min-h-11 md:min-h-0 px-4 py-2 md:py-1.5 bg-gray-900 text-white text-sm rounded hover:bg-gray-800 disabled:opacity-50"
            >
              Agregar
            </button>
          </div>

          <div className="text-[11px] text-gray-500 leading-relaxed space-y-1.5 pt-2 border-t border-gray-100">
            <p>
              <span className="font-medium">Reembolsador clásico</span> (sin RUT
              empresa): cuando la glosa matchea, asumimos que la factura puede ser
              de cualquier proveedor (compras que la persona pagó con su tarjeta).
            </p>
            <p>
              <span className="font-medium">Con alias de empresa</span> (uno o
              varios RUTs): cuando la glosa matchea, el modal filtra
              automáticamente las facturas por esos RUTs. Útil cuando le pagás a
              la persona pero las facturas las emite su empresa o un proveedor
              recurrente. Si la persona compra en varios lugares (ej. Cristóbal
              en Paula Johanna O Sodimac), agregás ambos.
            </p>
          </div>
        </form>
      </div>

      {items.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl">
          <p className="p-6 text-center text-sm text-gray-500">
            Todavía no hay reembolsadores. Agregá el primero arriba.
          </p>
        </div>
      ) : (
        <>
          {/* ── Lista en mobile: una tarjeta por persona ──────────────────
              La tabla de abajo tiene 5 columnas con anchos fijos (w-40, w-32,
              w-32) que suman bastante más que el ancho de un celular. Sin esto
              se salía de la pantalla o se aplastaba ilegible. Misma información,
              apilada y con los rótulos puestos al lado del dato. */}
          <div className="md:hidden space-y-3">
            {items.map((r) => {
              if (editingId === r.id) {
                return (
                  <div
                    key={r.id}
                    className="bg-white border border-gray-300 rounded-xl p-4 space-y-3"
                  >
                    <CamposReembolsador
                      valNombre={editNombre}
                      setValNombre={setEditNombre}
                      valGlosa={editGlosa}
                      setValGlosa={setEditGlosa}
                      valRut={editPersonRut}
                      setValRut={setEditPersonRut}
                      conPlaceholders={false}

                      disabled={busy}
                    />
                    <AliasListEditor
                      aliases={editAliases}
                      onChange={setEditAliases}
                      disabled={busy}
                    />
                    {error && <p className="text-xs text-red-700">{error}</p>}
                    <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={busy}
                        className="flex-1 min-h-11 border border-gray-300 rounded text-sm text-gray-700 disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveEdit}
                        disabled={busy}
                        className="flex-1 min-h-11 bg-gray-900 text-white text-sm rounded disabled:opacity-50"
                      >
                        Guardar
                      </button>
                    </div>
                  </div>
                );
              }

              const effectiveAliases = aliasesEfectivos(r);
              return (
                <div
                  key={r.id}
                  className="bg-white border border-gray-200 rounded-xl p-4"
                >
                  <div className="text-sm font-medium text-gray-900">
                    {r.nombre}
                  </div>

                  <dl className="mt-2.5 space-y-1.5 text-xs">
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-gray-500">RUT persona</dt>
                      <dd className="font-mono text-gray-700 break-all">
                        {r.personRut || <span className="text-gray-300">—</span>}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-gray-500">Glosa</dt>
                      <dd className="font-mono text-gray-700 break-all">
                        {r.glosa}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-gray-500">Empresas</dt>
                      <dd className="min-w-0">
                        {effectiveAliases.length === 0 ? (
                          <span className="text-gray-400">
                            cualquier proveedor
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {effectiveAliases.map((a, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-full px-2.5 py-0.5"
                              >
                                <span className="text-gray-900">
                                  {a.businessName ?? a.rut}
                                </span>
                                {a.businessName && (
                                  <span className="text-gray-400 font-mono">
                                    {a.rut}
                                  </span>
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                      </dd>
                    </div>
                  </dl>

                  {/* Editar es la acción normal y va primero, con su tamaño;
                      Borrar queda al otro extremo, sin borde y en gris, para
                      que no se toque de pasada. Antes Editar era flex-1 y se
                      comía dos tercios del ancho sin necesidad. */}
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => startEdit(r)}
                      disabled={busy}
                      className="min-h-11 px-6 border border-gray-300 rounded text-sm text-gray-700 disabled:opacity-50"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(r.id)}
                      disabled={busy}
                      className="ml-auto min-h-11 px-3 text-sm text-gray-500 hover:text-rose-700 disabled:opacity-50"
                    >
                      Borrar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Lista en desktop: la tabla densa de siempre ───────────────── */}
          <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2 w-40">Nombre</th>
                  <th className="text-left px-4 py-2 w-32">RUT persona</th>
                  <th className="text-left px-4 py-2 w-32">Glosa</th>
                  <th className="text-left px-4 py-2">Empresas alias</th>
                  <th className="px-4 py-2 w-32"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((r) => {
                  if (editingId === r.id) {
                    return (
                      <tr key={r.id} className="bg-gray-50 align-top">
                        <td className="px-4 py-3" colSpan={5}>
                          <div className="space-y-3">
                            <CamposReembolsador
                              valNombre={editNombre}
                              setValNombre={setEditNombre}
                              valGlosa={editGlosa}
                              setValGlosa={setEditGlosa}
                              valRut={editPersonRut}
                              setValRut={setEditPersonRut}
                              conPlaceholders={false}

                              disabled={busy}
                            />
                            <AliasListEditor
                              aliases={editAliases}
                              onChange={setEditAliases}
                              disabled={busy}
                            />
                            {error && (
                              <p className="text-xs text-red-700">{error}</p>
                            )}
                            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200">
                              <button
                                type="button"
                                onClick={cancelEdit}
                                disabled={busy}
                                className="text-xs text-gray-600 hover:text-gray-900"
                              >
                                cancelar
                              </button>
                              <button
                                type="button"
                                onClick={handleSaveEdit}
                                disabled={busy}
                                className="px-4 py-1.5 bg-gray-900 text-white text-sm rounded hover:bg-gray-800 disabled:opacity-50"
                              >
                                Guardar
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  const effectiveAliases = aliasesEfectivos(r);
                  return (
                    <tr key={r.id} className="hover:bg-gray-50 align-top">
                      <td className="px-4 py-2 text-gray-900 font-medium">
                        {r.nombre}
                      </td>
                      <td className="px-4 py-2 text-gray-600 font-mono text-xs">
                        {r.personRut || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-2 text-gray-600 font-mono text-xs">
                        {r.glosa}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {effectiveAliases.length === 0 ? (
                          <span className="text-gray-300">
                            — (compras de cualquier proveedor)
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {effectiveAliases.map((a, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-full px-2.5 py-0.5"
                              >
                                <span className="text-gray-900">
                                  {a.businessName ?? a.rut}
                                </span>
                                {a.businessName && (
                                  <span className="text-gray-400 font-mono">
                                    {a.rut}
                                  </span>
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right space-x-3">
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          disabled={busy}
                          className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-50"
                        >
                          editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(r.id)}
                          disabled={busy}
                          className="text-xs text-gray-400 hover:text-rose-700 disabled:opacity-50"
                        >
                          borrar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Campos base del reembolsador (nombre · glosa · RUT), compartidos por el form
 * de creación y por los dos modos de edición (tarjeta en mobile, fila en
 * desktop).
 *
 * OJO: va a nivel de módulo, NO adentro de `ReembolsadoresEditor`. Un
 * componente definido dentro del render se re-crea en cada render, React lo
 * trata como un tipo nuevo y desmonta el árbol — el input perdería el foco a
 * cada tecla y habría que volver a tocarlo para escribir la segunda letra.
 */
function CamposReembolsador({
  valNombre,
  setValNombre,
  valGlosa,
  setValGlosa,
  valRut,
  setValRut,
  conPlaceholders,
  disabled,
}: {
  valNombre: string;
  setValNombre: (v: string) => void;
  valGlosa: string;
  setValGlosa: (v: string) => void;
  valRut: string;
  setValRut: (v: string) => void;
  conPlaceholders: boolean;
  disabled: boolean;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div>
        <label className="block text-xs text-gray-600 mb-1">Nombre</label>
        <input
          type="text"
          value={valNombre}
          onChange={(e) => setValNombre(e.target.value)}
          placeholder={conPlaceholders ? "Cristobal · Jose Perez" : undefined}
          className={INPUT}
          disabled={disabled}
        />
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">
          Glosa que matchea{" "}
          <span className="text-gray-400">(no importan mayúsculas)</span>
        </label>
        <input
          type="text"
          value={valGlosa}
          onChange={(e) => setValGlosa(e.target.value)}
          placeholder={conPlaceholders ? "cristobal · jose perez" : undefined}
          className={INPUT}
          disabled={disabled}
        />
      </div>
      <div className="md:col-span-2">
        <label className="block text-xs text-gray-600 mb-1">
          RUT de la persona en la transferencia{" "}
          <span className="text-gray-400">
            (recomendado — match más confiable que el nombre)
          </span>
        </label>
        <input
          type="text"
          inputMode="numeric"
          value={valRut}
          onChange={(e) => setValRut(e.target.value)}
          placeholder="0183655213"
          className={`${INPUT} font-mono`}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

/**
 * Aliases efectivos de un reembolsador: la lista nueva si existe, y si no el
 * `rutAlias` legacy convertido a un alias suelto.
 */
function aliasesEfectivos(r: Reembolsador): { rut: string; businessName: string | null }[] {
  if (r.aliases && r.aliases.length > 0) return r.aliases;
  if (r.rutAlias) return [{ rut: r.rutAlias, businessName: r.businessName ?? null }];
  return [];
}

/**
 * Sub-componente: editor de una lista de aliases (rut + businessName).
 * Permite agregar/quitar filas. Usado tanto en el form de creación como
 * en el modo edición inline.
 */
function AliasListEditor({
  aliases,
  onChange,
  disabled,
}: {
  aliases: Alias[];
  onChange: (next: Alias[]) => void;
  disabled: boolean;
}) {
  function update(idx: number, patch: Partial<Alias>) {
    onChange(aliases.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  }
  function remove(idx: number) {
    const next = aliases.filter((_, i) => i !== idx);
    onChange(next.length > 0 ? next : [{ rut: "", businessName: "" }]);
  }
  function add() {
    onChange([...aliases, { rut: "", businessName: "" }]);
  }
  return (
    <div className="space-y-2 pt-2 border-t border-gray-100">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-600">
          Empresas alias{" "}
          <span className="text-gray-400">
            (opcional · una o varias · ej. proveedor a quien siempre compra)
          </span>
        </p>
      </div>
      {aliases.map((a, idx) => (
        // En mobile cada alias es su propio bloque con borde: sin eso, dos
        // aliases seguidos se leen como cuatro campos sueltos y no se ve cuál
        // RUT va con cuál nombre.
        <div
          key={idx}
          className="border border-gray-100 rounded p-3 md:p-0 md:border-0 grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-2 md:items-end"
        >
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">
              RUT empresa
            </label>
            <input
              type="text"
              value={a.rut}
              onChange={(e) => update(idx, { rut: e.target.value })}
              placeholder="77270733-9"
              className={`${INPUT} font-mono`}
              disabled={disabled}
            />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">
              Nombre empresa
            </label>
            <input
              type="text"
              value={a.businessName ?? ""}
              onChange={(e) => update(idx, { businessName: e.target.value })}
              placeholder="Paula Johanna SpA"
              className={INPUT}
              disabled={disabled}
            />
          </div>
          {/* min-h-11 (44px) en el celular: es el mínimo para acertarle con el
              dedo. En md+ vuelve al alto chico de siempre. */}
          <button
            type="button"
            onClick={() => remove(idx)}
            disabled={disabled}
            className="justify-self-start md:justify-self-auto min-h-11 md:min-h-0 text-xs text-gray-500 hover:text-rose-700 disabled:opacity-50 px-2 py-2 md:py-1.5 -ml-2 md:ml-0"
            title="Quitar este alias"
          >
            quitar
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        disabled={disabled}
        className="min-h-11 md:min-h-0 px-2 -ml-2 md:ml-0 md:px-0 text-xs text-gray-600 hover:text-gray-900 disabled:opacity-50"
      >
        + agregar otro alias
      </button>
    </div>
  );
}
