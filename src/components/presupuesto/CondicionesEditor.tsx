"use client";

import { useEffect, useRef, useState } from "react";
import type { Condicion, TipoCondiciones } from "@/lib/presupuesto/condiciones";

/**
 * Editor de las condiciones que salen impresas en el PDF del cliente.
 *
 * Sirve para las dos pantallas:
 *   modo="cotizacion" → las condiciones de ESA versión (lo que ves es lo que
 *                       sale en el PDF). Trae "volver a las estándar" y, al
 *                       agregar una, el tilde para dejarla también en la
 *                       plantilla.
 *   modo="plantilla"  → la lista estándar del tipo, en Configuración. Solo
 *                       define con qué texto arrancan las cotizaciones NUEVAS.
 *
 * Guarda solo (sin botón), con medio segundo de espera después de la última
 * tecla — igual que el editor del Estado de Pago.
 */

const MS_DEBOUNCE = 600;

const NOMBRE_TIPO: Record<TipoCondiciones, string> = {
  obra: "obra",
  muebles: "muebles",
  artefactos: "artefactos",
};

interface Fila extends Condicion {
  /** Clave estable para React: las filas no tienen id en la base. */
  key: string;
  /** Recién agregada a mano: mientras dure, se ofrece guardarla en la plantilla. */
  nueva?: boolean;
  /**
   * El tilde "dejarla también para las próximas" está prendido. Arranca
   * APAGADO a propósito: casi siempre lo que se agrega es de esa obra nomás, y
   * una condición puntual metida en la plantilla se arrastra a todo lo que
   * venga después (mismo criterio que las reglas de proveedor, §4.5).
   */
  pendientePlantilla?: boolean;
  /** Ya quedó guardada en la plantilla (el tilde pasa a ser un aviso). */
  enPlantilla?: boolean;
}

let contadorKeys = 0;
function aFilas(items: Condicion[]): Fila[] {
  return items.map((c) => ({ ...c, key: `c${contadorKeys++}` }));
}

export default function CondicionesEditor({
  modo,
  tipo,
  budgetId,
  inicial,
}: {
  modo: "cotizacion" | "plantilla";
  tipo: TipoCondiciones;
  budgetId?: string;
  inicial: Condicion[];
}) {
  const [filas, setFilas] = useState<Fila[]>(() => aFilas(inicial));
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // El primer render no debe disparar un guardado: sin esto, abrir la pantalla
  // escribía en la base sin que nadie tocara nada.
  const montado = useRef(false);

  useEffect(() => {
    if (!montado.current) {
      montado.current = true;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(guardar, MS_DEBOUNCE);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas]);

  async function guardar() {
    const items: Condicion[] = filas
      .map((f) => ({ lead: f.lead?.trim() || null, text: f.text.trim() }))
      .filter((c) => c.text);
    setGuardando(true);
    try {
      if (modo === "cotizacion") {
        await fetch(`/api/presupuestos/${budgetId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conditions: items }),
        });
      } else {
        await fetch("/api/condiciones-estandar", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tipo, items }),
        });
      }
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2000);
    } catch {
      alert("No se pudieron guardar las condiciones");
    } finally {
      setGuardando(false);
    }
  }

  function editar(key: string, patch: Partial<Fila>) {
    setFilas((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }

  function borrar(key: string) {
    setFilas((prev) => prev.filter((f) => f.key !== key));
  }

  function mover(index: number, delta: number) {
    setFilas((prev) => {
      const destino = index + delta;
      if (destino < 0 || destino >= prev.length) return prev;
      const copia = [...prev];
      const [fila] = copia.splice(index, 1);
      copia.splice(destino, 0, fila);
      return copia;
    });
  }

  function agregar() {
    setFilas((prev) => [
      ...prev,
      { key: `c${contadorKeys++}`, text: "", nueva: modo === "cotizacion" },
    ]);
  }

  async function volverAEstandar() {
    if (
      !confirm(
        "Se reemplazan las condiciones de esta cotización por las estándar. Lo que hayas escrito acá se pierde."
      )
    )
      return;
    const res = await fetch(`/api/condiciones-estandar?tipo=${tipo}`);
    if (!res.ok) {
      alert("No se pudieron traer las condiciones estándar");
      return;
    }
    const { items } = (await res.json()) as { items: Condicion[] };
    setFilas(aFilas(items));
  }

  /** Tilde "dejarla también para las próximas": manda la condición a la plantilla. */
  async function guardarEnPlantilla(fila: Fila) {
    const text = fila.text.trim();
    if (!text) return;
    const res = await fetch("/api/condiciones-estandar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipo,
        condicion: { lead: fila.lead?.trim() || null, text },
      }),
    });
    if (!res.ok) {
      alert("No se pudo guardar en las condiciones estándar");
      return;
    }
    editar(fila.key, { enPlantilla: true, nueva: false });
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          {/* En Configuración el título lo pone la pantalla (una sección por
              tipo), así que acá no se repite. */}
          {modo === "cotizacion" && (
            <h2 className="text-lg font-semibold text-gray-900">Condiciones</h2>
          )}
          <p className="text-sm text-gray-500 mt-0.5">
            {modo === "cotizacion"
              ? "Salen en el PDF del cliente, numeradas, en este orden."
              : `Con esto arrancan las cotizaciones nuevas de ${NOMBRE_TIPO[tipo]}. No cambia ninguna cotización ya creada.`}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span
            className={`text-xs ${
              guardado ? "text-green-700" : "text-gray-400"
            }`}
          >
            {guardando ? "Guardando…" : guardado ? "Guardado" : ""}
          </span>
          {modo === "cotizacion" && (
            <button
              onClick={volverAEstandar}
              className="text-xs text-gray-600 hover:text-gray-900 border border-gray-300 rounded px-2 py-1"
            >
              Volver a las estándar
            </button>
          )}
        </div>
      </div>

      <div className="mt-4">
        {filas.length === 0 && (
          <p className="text-sm text-gray-400 border-t border-gray-200 pt-3">
            Sin condiciones. El PDF sale sin el bloque de observaciones.
          </p>
        )}

        {filas.map((fila, i) => (
          <div
            key={fila.key}
            className="flex items-start gap-3 border-t border-gray-200 py-2.5"
          >
            <span className="text-xs text-gray-400 tabular-nums w-4 text-right pt-2">
              {i + 1}
            </span>

            <div className="flex-1 min-w-0">
              {fila.lead !== undefined && fila.lead !== null && (
                <input
                  value={fila.lead}
                  onChange={(e) => editar(fila.key, { lead: e.target.value })}
                  placeholder="Título en negrita (ej. Plazos de entrega.)"
                  className="w-full mb-1 px-2 py-1 border border-gray-200 rounded text-sm font-medium outline-none focus:border-gray-500"
                />
              )}
              <textarea
                value={fila.text}
                onChange={(e) => editar(fila.key, { text: e.target.value })}
                onBlur={() => {
                  if (fila.nueva && fila.pendientePlantilla) guardarEnPlantilla(fila);
                }}
                rows={1}
                placeholder="Escribí la condición…"
                // field-sizing-content: la caja crece con el texto. Con alto
                // fijo, las condiciones de un renglón dejaban un hueco vacío
                // abajo y la lista de 8 quedaba larguísima.
                className="w-full field-sizing-content px-2 py-1.5 border border-gray-200 rounded text-sm leading-relaxed outline-none focus:border-gray-500 resize-none"
              />

              {fila.nueva && (
                <label className="flex items-center gap-2 mt-1.5 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={!!fila.pendientePlantilla}
                    onChange={(e) =>
                      editar(fila.key, { pendientePlantilla: e.target.checked })
                    }
                    className="w-4 h-4 accent-gray-900"
                  />
                  Dejarla también para las próximas cotizaciones de{" "}
                  {NOMBRE_TIPO[tipo]}
                </label>
              )}
              {fila.enPlantilla && (
                <p className="mt-1.5 text-xs text-gray-500">
                  Guardada en las condiciones estándar. Lo que edites acá de
                  ahora en adelante es solo de esta cotización.
                </p>
              )}
            </div>

            <div className="flex items-center gap-0.5 pt-1 shrink-0">
              {fila.lead === undefined || fila.lead === null ? (
                <button
                  onClick={() => editar(fila.key, { lead: "" })}
                  title="Agregar título en negrita"
                  className="px-1 text-xs text-gray-300 hover:text-gray-700 font-medium"
                >
                  T
                </button>
              ) : null}
              <button
                onClick={() => mover(i, -1)}
                disabled={i === 0}
                title="Subir"
                className="px-1 text-sm text-gray-400 hover:text-gray-900 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                onClick={() => mover(i, 1)}
                disabled={i === filas.length - 1}
                title="Bajar"
                className="px-1 text-sm text-gray-400 hover:text-gray-900 disabled:opacity-30"
              >
                ↓
              </button>
              <button
                onClick={() => borrar(fila.key)}
                title="Borrar"
                className="px-1 text-sm text-gray-400 hover:text-red-700"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={agregar}
        className="mt-3 text-sm text-gray-600 hover:text-gray-900 font-medium"
      >
        + agregar condición
      </button>
    </div>
  );
}
