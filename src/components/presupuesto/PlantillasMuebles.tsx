"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Plantillas de muebles en el editor (pedido de MJ, 2026-09-11): dos piezas
 * chicas que se enchufan donde ya se agregan capítulos y partidas.
 *
 *  - <MenuPlantillas nivel="capitulo" | "partida" onElegir={…} /> — el link
 *    "desde plantilla" que despliega la lista (capítulos tipo, o partidas tipo
 *    sueltas más las de cada capítulo tipo) y deja borrar una con ✕.
 *  - <BotonGuardarPlantilla tipo="capitulo" | "partida" id nombreSugerido /> —
 *    guarda ese capítulo o esa partida REAL como plantilla, pidiendo el nombre.
 *    Si ya hay una con ese nombre, la reemplaza (así se corrige una plantilla
 *    guardando de nuevo desde una partida mejor armada).
 *
 * La lista se pide al servidor cada vez que se abre: es chica y así siempre
 * refleja lo último guardado, sin estado compartido entre los menús.
 */

type Detalle = { name: string; material: string };
type PartidaTipo = { id: string; name: string; kind: string; details: Detalle[] };
type CapituloTipo = { id: string; name: string; items: PartidaTipo[] };
type Listado = { capitulos: CapituloTipo[]; partidas: PartidaTipo[] };

export function MenuPlantillas({
  nivel,
  onElegir,
  className = "",
}: {
  nivel: "capitulo" | "partida";
  onElegir: (templateId: string, nombre: string) => void | Promise<void>;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [lista, setLista] = useState<Listado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [eligiendo, setEligiendo] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // El desplegable se dibuja en el body con posición fija (portal): la tabla
  // del presupuesto recorta lo que se sale de su borde (overflow hidden) y
  // adentro se veía cortado.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  async function cargar() {
    setCargando(true);
    try {
      const res = await fetch("/api/catalogo/plantillas-muebles");
      setLista(res.ok ? await res.json() : { capitulos: [], partidas: [] });
    } catch {
      setLista({ capitulos: [], partidas: [] });
    } finally {
      setCargando(false);
    }
  }

  // Cerrar al hacer clic afuera.
  useEffect(() => {
    if (!abierto) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setAbierto(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [abierto]);

  async function borrar(id: string, tipo: "capitulo" | "partida", nombre: string) {
    if (!confirm(`¿Borrar la plantilla "${nombre}"? Las partidas ya creadas con ella no cambian.`)) return;
    await fetch(`/api/catalogo/plantillas-muebles/${id}?tipo=${tipo}`, { method: "DELETE" });
    await cargar();
  }

  async function elegir(id: string, nombre: string) {
    setEligiendo(true);
    try {
      await onElegir(id, nombre);
      setAbierto(false);
    } finally {
      setEligiendo(false);
    }
  }

  // Filas del menú según el nivel. Para partidas: las sueltas y, debajo, las
  // de cada capítulo tipo rotuladas "Cocina · MUEBLES".
  const filas: { id: string; etiqueta: string; sub: string; tipo: "capitulo" | "partida" }[] = [];
  if (lista) {
    if (nivel === "capitulo") {
      for (const c of lista.capitulos) {
        filas.push({ id: c.id, etiqueta: c.name, sub: c.items.map((i) => i.name).join(" · "), tipo: "capitulo" });
      }
    } else {
      for (const p of lista.partidas) {
        filas.push({ id: p.id, etiqueta: p.name, sub: resumen(p), tipo: "partida" });
      }
      for (const c of lista.capitulos) {
        for (const p of c.items) {
          filas.push({ id: p.id, etiqueta: `${c.name} · ${p.name}`, sub: resumen(p), tipo: "partida" });
        }
      }
    }
  }

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        onClick={(e) => {
          const siguiente = !abierto;
          if (siguiente) {
            const r = e.currentTarget.getBoundingClientRect();
            setPos({ top: r.bottom + 4, left: r.left });
            cargar();
          }
          setAbierto(siguiente);
        }}
        className="text-gray-400 hover:text-gray-900"
        title={
          nivel === "capitulo"
            ? "Crear el capítulo con sus partidas y componentes ya armados, desde una plantilla tuya"
            : "Crear la partida con sus componentes ya armados, desde una plantilla tuya"
        }
      >
        desde plantilla {abierto ? "▴" : "▾"}
      </button>
      {abierto && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: pos.top, left: pos.left }}
          className="z-50 w-96 max-h-80 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-sm text-xs"
        >
          {cargando && <div className="px-3 py-2 text-gray-500">Cargando…</div>}
          {!cargando && filas.length === 0 && (
            <div className="px-3 py-3 text-gray-500 leading-snug">
              Todavía no hay plantillas. Armá bien {nivel === "capitulo" ? "un capítulo" : "una partida"} y
              apretá &quot;Guardar como plantilla&quot;.
            </div>
          )}
          {!cargando &&
            filas.map((f) => (
              <div
                key={f.id}
                className="flex items-start gap-2 px-3 py-2 border-b border-gray-100 last:border-b-0 hover:bg-gray-50"
              >
                <button
                  onClick={() => elegir(f.id, f.etiqueta)}
                  disabled={eligiendo}
                  className="flex-1 text-left disabled:opacity-50"
                >
                  <div className="font-medium text-gray-900">{f.etiqueta}</div>
                  {f.sub && <div className="text-[10px] text-gray-500 leading-snug">{f.sub}</div>}
                </button>
                <button
                  onClick={() => borrar(f.id, f.tipo, f.etiqueta)}
                  className="text-gray-300 hover:text-red-600 leading-none px-1"
                  title="Borrar esta plantilla"
                >
                  ✕
                </button>
              </div>
            ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

function resumen(p: PartidaTipo): string {
  if (p.kind === "herrajes") return "partida de herrajes (se llena del catálogo)";
  const n = p.details.length;
  if (n === 0) return "sin componentes";
  return p.details.map((d) => d.name || d.material).filter(Boolean).slice(0, 6).join(" · ") + (n > 6 ? " …" : "");
}

export function BotonGuardarPlantilla({
  tipo,
  id,
  nombreSugerido,
  className = "",
}: {
  tipo: "capitulo" | "partida";
  id: string;
  nombreSugerido: string;
  className?: string;
}) {
  const [estado, setEstado] = useState<"" | "guardando" | "ok" | "error">("");

  async function guardar() {
    const sugerido = nombreSugerido.trim()
      ? nombreSugerido.trim().charAt(0).toUpperCase() + nombreSugerido.trim().slice(1).toLowerCase()
      : "";
    const nombre = prompt(
      tipo === "capitulo"
        ? "Nombre de la plantilla de capítulo (ej. Cocina, Baño, Closet):"
        : "Nombre de la plantilla de partida (ej. Cubiertas):",
      sugerido,
    );
    if (nombre === null) return;
    if (!nombre.trim()) return alert("La plantilla necesita un nombre.");
    setEstado("guardando");
    try {
      const res = await fetch("/api/catalogo/plantillas-muebles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tipo === "capitulo" ? { tipo, chapterId: id, name: nombre.trim() } : { tipo, itemId: id, name: nombre.trim() }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setEstado("ok");
      if (data.reemplazo) alert(`La plantilla "${nombre.trim()}" ya existía y se reemplazó con esta versión.`);
      setTimeout(() => setEstado(""), 2500);
    } catch {
      setEstado("error");
      setTimeout(() => setEstado(""), 3000);
    }
  }

  return (
    <button
      onClick={guardar}
      disabled={estado === "guardando"}
      className={`text-gray-400 hover:text-gray-900 disabled:opacity-50 whitespace-nowrap ${className}`}
      title={
        tipo === "capitulo"
          ? "Guardar este capítulo (sus partidas y componentes, sin precios) como plantilla para otras cotizaciones"
          : "Guardar esta partida (sus componentes, sin precios) como plantilla para otras cotizaciones"
      }
    >
      {estado === "guardando"
        ? "guardando…"
        : estado === "ok"
          ? "plantilla guardada"
          : estado === "error"
            ? "no se pudo guardar"
            : "Guardar como plantilla"}
    </button>
  );
}
