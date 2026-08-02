"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCLP } from "@/lib/utils";
import { comprimirImagen } from "@/lib/comprimirImagen";

// Modal "Reembolso de boletas": un egreso del banco que cubre VARIAS boletas.
//
// Caso real: se le transfieren $63.773 a Daniel Ignacio, que puso de su bolsillo
// tres boletas de obras distintas. Se arrastran las fotos, la app propone los
// datos de cada una (número, fecha, comercio, monto), MJ corrige lo que haga
// falta y le pone obra a cada boleta. Cada una queda como su propio gasto con
// su foto de respaldo, todas colgadas del mismo movimiento.
//
// La suma nunca puede pasar el saldo libre del movimiento (el servidor lo
// vuelve a chequear). Si suma MENOS, se permite a propósito: se avisa cuánto
// falta y el movimiento queda parcial.

type Estado = "leyendo" | "leida" | "revisar" | "manual";

interface Fila {
  key: string;
  foto: string | null; // data URL comprimido
  numeroDoc: string;
  fecha: string; // YYYY-MM-DD
  comercio: string;
  monto: string; // texto, se parsea al guardar
  projectId: string;
  estado: Estado;
  nota: string | null;
}

let contador = 0;
function nuevaFila(foto: string | null, estado: Estado): Fila {
  contador += 1;
  return {
    key: `f${contador}`,
    foto,
    numeroDoc: "",
    fecha: "",
    comercio: "",
    monto: "",
    projectId: "",
    estado,
    nota: null,
  };
}

// Acepta "27.303", "27303", "$27.303" → 27303. Devuelve null si no es número.
function parsearMonto(txt: string): number | null {
  const limpio = txt.replace(/[^\d]/g, "");
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ¿Esto parece una foto? No alcanza con mirar el MIME type: arrastrando desde
// algunas apps (o desde un pendrive) el archivo llega con `type` vacío, y así
// se descartaban fotos perfectamente buenas sin decir nada. Si el tipo no
// ayuda, se mira la extensión.
const EXTENSIONES_FOTO = /\.(jpe?g|png|webp|gif|heic|heif|bmp|tiff?)$/i;
function pareceFoto(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  if (file.type) return false;
  return EXTENSIONES_FOTO.test(file.name);
}

// Techo del data URL que acepta el servidor que lee la foto (5 MB). Se deja un
// margen para el resto del JSON.
const TECHO_FOTO = 4.5 * 1024 * 1024;

// Lee el archivo tal cual, sin comprimir. Es el plan B cuando el navegador no
// sabe decodificar la imagen (típico: un HEIC de iPhone en Chrome). La foto no
// se puede achicar, pero al menos queda adjunta y la fila aparece.
function leerCrudo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("No se pudo leer el archivo"));
    fr.readAsDataURL(file);
  });
}

export default function ReembolsoBoletasModal({
  movementId,
  contraparte,
  fechaMovimiento,
  montoMovimiento,
  yaImputado,
  projects,
  categories,
  onClose,
  onDone,
}: {
  movementId: string;
  contraparte: string;
  fechaMovimiento: string;
  // Monto total del movimiento, en positivo.
  montoMovimiento: number;
  // Lo que ya estaba imputado antes de abrir el modal.
  yaImputado: number;
  projects: { id: string; name: string; numeroProyecto: number | null }[];
  categories: { id: string; label: string }[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Avisos que no son errores (archivos ignorados, fotos que no se pudieron
  // achicar): van en ámbar, no en rojo.
  const [aviso, setAviso] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);

  const libre = montoMovimiento - yaImputado;
  const suma = filas.reduce((s, f) => s + (parsearMonto(f.monto) ?? 0), 0);
  const diferencia = libre - suma;
  const seExcede = suma > libre;
  const hayMontoInvalido = filas.some((f) => parsearMonto(f.monto) === null);
  const puedeGuardar =
    filas.length > 0 && !hayMontoInvalido && !seExcede && !!categoryId && !busy;

  function actualizar(key: string, campos: Partial<Fila>) {
    setFilas((prev) => prev.map((f) => (f.key === key ? { ...f, ...campos } : f)));
  }

  // Manda una foto a leer. Es una PROPUESTA: si falla por lo que sea (no está
  // la llave, la foto es ilegible, se cayó la red), la fila NO desaparece —
  // queda para cargar a mano con el motivo a la vista.
  async function leerFoto(fila: Fila) {
    if (!fila.foto) return;
    try {
      const res = await fetch("/api/contabilidad/gastos/leer-boleta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagen: fila.foto }),
      });
      if (!res.ok) {
        const cuerpo = await res.json().catch(() => null);
        throw new Error(cuerpo?.error || `La lectura falló (${res.status})`);
      }
      const d = await res.json();
      actualizar(fila.key, {
        numeroDoc: d.numeroDoc ?? "",
        fecha: d.fecha ?? "",
        comercio: d.comercio ?? "",
        monto: d.monto != null ? String(d.monto) : "",
        estado: d.confianza === "alta" ? "leida" : "revisar",
        nota: d.nota ?? (d.confianza === "alta" ? null : "Revisá los datos."),
      });
    } catch (e) {
      actualizar(fila.key, {
        estado: "manual",
        nota:
          e instanceof Error && e.message
            ? e.message
            : "No se pudo leer la foto: completá los datos a mano.",
      });
    }
  }

  // Carga de fotos, tanto del selector como de arrastrar y soltar.
  //
  // Primero entran TODAS las filas y recién después se manda a leer. Antes era
  // archivo por archivo (comprimir → leer → siguiente): la segunda foto no
  // aparecía hasta que terminaba la lectura de la primera y parecía colgado.
  async function agregarFotos(lista: FileList | File[] | null) {
    const todos = lista ? Array.from(lista) : [];
    if (todos.length === 0) return;
    setError(null);
    setAviso(null);

    const archivos = todos.filter(pareceFoto);
    if (archivos.length === 0) {
      setError(
        todos.length === 1
          ? "Ese archivo no es una foto. Subí una imagen de la boleta (JPG, PNG o HEIC)."
          : "Ninguno de los archivos es una foto. Subí imágenes de las boletas (JPG, PNG o HEIC)."
      );
      return;
    }
    const ignorados = todos.length - archivos.length;

    const nuevas: Fila[] = [];
    for (const file of archivos) {
      let foto: string | null = null;
      let nota: string | null = null;
      let legible = false;
      try {
        foto = await comprimirImagen(file);
        legible = true;
      } catch {
        // El navegador no supo decodificarla (típico: un HEIC de iPhone en
        // Chrome). Se adjunta cruda si entra, así al menos queda el respaldo;
        // leerla automáticamente ya no se puede.
        try {
          const crudo = await leerCrudo(file);
          if (crudo.length <= TECHO_FOTO) {
            foto = crudo;
            nota = `"${file.name}": no se pudo achicar, queda tal cual. Completá los datos a mano.`;
          } else {
            nota = `"${file.name}" pesa demasiado y el navegador no la pudo achicar. Sacá la foto de nuevo o cargá los datos a mano.`;
          }
        } catch {
          nota = `No se pudo abrir "${file.name}". Cargá los datos a mano.`;
        }
      }
      nuevas.push({ ...nuevaFila(foto, legible ? "leyendo" : "manual"), nota });
    }

    setFilas((prev) => [...prev, ...nuevas]);
    if (ignorados > 0) {
      setAviso(
        ignorados === 1
          ? "Se ignoró 1 archivo que no es una foto."
          : `Se ignoraron ${ignorados} archivos que no son fotos.`
      );
    }

    // Las lecturas van en paralelo: las filas ya están en pantalla y cada una
    // se completa sola cuando vuelve la suya.
    await Promise.all(
      nuevas.filter((f) => f.estado === "leyendo").map((f) => leerFoto(f))
    );
  }

  async function guardar() {
    if (!puedeGuardar) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/banco/movimientos/${movementId}/reembolso-boletas`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            boletas: filas.map((f) => ({
              numeroDoc: f.numeroDoc.trim() || null,
              fecha: f.fecha || null,
              comercio: f.comercio.trim() || null,
              monto: parsearMonto(f.monto),
              projectId: f.projectId || null,
              categoryId,
              foto: f.foto,
            })),
          }),
        }
      );
      if (!res.ok) {
        const cuerpo = await res.json().catch(() => null);
        throw new Error(cuerpo?.error ?? "No se pudo registrar");
      }
      onDone?.();
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-6">
      {/* El arrastrar-y-soltar se escucha en TODO el modal, no solo en el
          recuadro: si la foto se suelta un centímetro al lado, el navegador la
          abriría en la pestaña y se perdería lo cargado. */}
      <div
        className="w-full max-w-4xl bg-white border border-gray-200 rounded-xl shadow-sm my-4"
        onDragOver={(e) => {
          // Sin preventDefault el navegador no deja soltar nada acá.
          e.preventDefault();
          if (!arrastrando) setArrastrando(true);
        }}
        onDragLeave={(e) => {
          // Solo cuando el puntero sale del modal entero, no al pasar de un
          // hijo a otro (dragleave se dispara en cada cambio de elemento).
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setArrastrando(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          setArrastrando(false);
          void agregarFotos(e.dataTransfer.files);
        }}
      >
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            Reembolso de boletas
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Transferencia a{" "}
            <span className="font-medium text-gray-700">{contraparte}</span> ·{" "}
            {fechaMovimiento} ·{" "}
            <span className="font-medium text-gray-700">
              {formatCLP(montoMovimiento)}
            </span>
            {yaImputado > 0 && (
              <> · ya imputado {formatCLP(yaImputado)}</>
            )}
          </p>
        </div>

        <div className="px-6 py-4">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={`w-full border border-dashed rounded-lg py-4 px-4 text-center transition-colors ${
              arrastrando
                ? "border-gray-900 bg-gray-50"
                : "border-gray-300 hover:bg-gray-50"
            }`}
          >
            <span className="block text-sm text-gray-700">
              {arrastrando
                ? "Soltá las fotos acá"
                : "Arrastrá las fotos de las boletas, o hacé clic para elegirlas"}
            </span>
            <span className="block text-xs text-gray-400 mt-1">
              Una foto por boleta. La app lee el número, la fecha y el monto; vos
              revisás.
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              // OJO: hay que copiar los archivos ANTES de limpiar el input.
              // `e.target.files` es una lista VIVA — al poner value = "" el
              // navegador la vacía y `agregarFotos` recibía cero archivos: no
              // aparecía ninguna fila ni ningún error. Ese era el bug por el
              // que "no pasaba nada" al elegir una foto.
              const archivos = Array.from(e.target.files ?? []);
              e.target.value = "";
              void agregarFotos(archivos);
            }}
          />

          {filas.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="text-[9px] uppercase tracking-wider text-gray-400">
                    <th className="w-6" />
                    <th className="w-12" />
                    <th className="text-left font-semibold px-2 pb-1">N° boleta</th>
                    <th className="text-left font-semibold px-2 pb-1">Fecha</th>
                    <th className="text-left font-semibold px-2 pb-1">Comercio</th>
                    <th className="text-left font-semibold px-2 pb-1">Monto</th>
                    <th className="text-left font-semibold px-2 pb-1">Obra</th>
                    <th className="w-6" />
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, i) => {
                    const montoNum = parsearMonto(f.monto);
                    return (
                      <tr key={f.key} className="border-t border-gray-100 align-top">
                        <td className="py-2 text-xs text-gray-400 tabular-nums">
                          {i + 1}
                        </td>
                        <td className="py-2">
                          {f.foto && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={f.foto}
                              alt={`Boleta ${i + 1}`}
                              className="w-10 h-12 object-cover rounded border border-gray-200"
                            />
                          )}
                        </td>
                        <td className="py-2 px-1">
                          <input
                            value={f.numeroDoc}
                            onChange={(e) =>
                              actualizar(f.key, { numeroDoc: e.target.value })
                            }
                            placeholder="—"
                            className="w-20 border border-gray-200 rounded px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="py-2 px-1">
                          <input
                            type="date"
                            value={f.fecha}
                            onChange={(e) =>
                              actualizar(f.key, { fecha: e.target.value })
                            }
                            className="w-32 border border-gray-200 rounded px-2 py-1 text-sm tabular-nums"
                          />
                        </td>
                        <td className="py-2 px-1">
                          <input
                            value={f.comercio}
                            onChange={(e) =>
                              actualizar(f.key, { comercio: e.target.value })
                            }
                            placeholder="comercio"
                            className="w-40 border border-gray-200 rounded px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="py-2 px-1">
                          <input
                            value={f.monto}
                            onChange={(e) =>
                              actualizar(f.key, { monto: e.target.value })
                            }
                            placeholder="$"
                            className={`w-24 border rounded px-2 py-1 text-sm tabular-nums ${
                              f.monto && montoNum === null
                                ? "border-red-300"
                                : "border-gray-200"
                            }`}
                          />
                        </td>
                        <td className="py-2 px-1">
                          <select
                            value={f.projectId}
                            onChange={(e) =>
                              actualizar(f.key, { projectId: e.target.value })
                            }
                            className="w-40 border border-gray-200 rounded px-2 py-1 text-sm"
                          >
                            <option value="">Sin obra (BLARQ)</option>
                            {projects.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.numeroProyecto != null
                                  ? `${p.numeroProyecto} · ${p.name}`
                                  : p.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2">
                          <button
                            type="button"
                            onClick={() =>
                              setFilas((prev) =>
                                prev.filter((x) => x.key !== f.key)
                              )
                            }
                            className="text-gray-400 hover:text-gray-700 px-1"
                            title="Quitar esta boleta"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Avisos de lectura, fuera de la tabla para no apretarla. */}
              <div className="mt-2 space-y-1">
                {filas.map((f, i) =>
                  f.estado === "leyendo" ? (
                    <p key={f.key} className="text-xs text-gray-400">
                      {i + 1} · leyendo la foto…
                    </p>
                  ) : f.nota ? (
                    <p key={f.key} className="text-xs text-amber-700">
                      {i + 1} · {f.nota}
                    </p>
                  ) : null
                )}
              </div>
            </div>
          )}

          {filas.length > 0 && (
            <>
              <div className="mt-4 flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5">
                <span className="text-sm text-gray-700">
                  {filas.length}{" "}
                  {filas.length === 1 ? "boleta suma" : "boletas suman"}{" "}
                  <span className="font-semibold tabular-nums">
                    {formatCLP(suma)}
                  </span>
                  <span className="text-gray-400">
                    {" "}
                    · disponible {formatCLP(libre)}
                  </span>
                </span>
                <span
                  className={`text-sm font-semibold tabular-nums ${
                    seExcede
                      ? "text-red-700"
                      : diferencia === 0
                        ? "text-gray-700"
                        : "text-amber-700"
                  }`}
                >
                  {seExcede
                    ? `Se pasa por ${formatCLP(-diferencia)}`
                    : diferencia === 0
                      ? "Cuadra"
                      : `Faltan ${formatCLP(diferencia)}`}
                </span>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <label className="text-xs text-gray-500">
                  Categoría para todas:
                </label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="border border-gray-200 rounded px-2 py-1 text-sm"
                >
                  <option value="">Elegí una…</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-gray-400">
                  Después se puede cambiar boleta por boleta en Gastos.
                </span>
              </div>

              {diferencia > 0 && !seExcede && (
                <p className="text-xs text-gray-500 mt-3 leading-relaxed">
                  Podés registrar igual: el movimiento queda parcial con{" "}
                  {formatCLP(diferencia)} pendiente, para cuando aparezcan las
                  boletas que faltan.
                </p>
              )}
            </>
          )}

          {aviso && <p className="text-xs text-amber-700 mt-3">{aviso}</p>}
          {error && <p className="text-sm text-red-700 mt-3">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50/60 rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm border border-gray-300 rounded text-gray-700 hover:bg-white disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={!puedeGuardar}
            className="px-4 py-2 text-sm bg-gray-900 text-white rounded hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy
              ? "Registrando…"
              : `Registrar ${filas.length || ""} ${
                  filas.length === 1 ? "boleta" : "boletas"
                }`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}
