"use client";

/**
 * Botón "Guardar al catálogo" para las partidas que MJ armó de cero en una
 * cotización (las que NO vienen del catálogo). Convierte esa partida —con todo
 * su desglose de materiales y mano de obra— en un molde reusable, en vez de
 * tener que rearmarla a mano en el Catálogo de Partidas.
 *
 * El botón se ofrece SOLO cuando el guardado va a salir limpio. Al abrir el
 * panel se le pregunta al server (GET) si se puede y en qué categoría caería;
 * si el nombre ya existe en esa categoría del catálogo, en vez del botón se
 * muestra cuál es el molde que ya está, con link para ir a verlo. Así no hay
 * forma de duplicar ni de pisar un molde sin darse cuenta.
 *
 * El server vuelve a chequear todo al crear: el nombre de la partida se edita
 * inline y puede cambiar con el panel abierto.
 */

import { useCallback, useEffect, useState } from "react";

interface Props {
  budgetId: string;
  itemId: string;
  itemName: string;
  canEdit: boolean;
  // Se llama con el id del molde recién creado, para que el editor deje la
  // partida enganchada en pantalla y aparezcan los botones de las partidas
  // que vienen del catálogo (sin recargar la página).
  onSaved: (catalogPartidaId: string) => void;
}

type Estado =
  | { puede: true; categoria: string; categoriaEsNueva: boolean }
  | {
      puede: false;
      motivo: "ya-tiene-molde" | "nombre-repetido" | "sin-capitulo" | "sin-nombre";
      categoria: string;
      moldeId?: string;
      moldeNombre?: string;
    };

export default function GuardarAlCatalogoButton(p: Props) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [guardando, setGuardando] = useState(false);

  const url = `/api/presupuestos/${p.budgetId}/partidas/${p.itemId}/crear-en-catalogo`;

  // Se consulta al abrir el panel. `itemName` está en las dependencias a
  // propósito: si MJ renombra la partida, el estado se vuelve a evaluar y el
  // botón aparece o desaparece según corresponda.
  useEffect(() => {
    let vivo = true;
    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (vivo && d) setEstado(d as Estado);
      })
      .catch(() => {
        /* si falla el previo, no mostramos nada: mejor eso que un botón que miente */
      });
    return () => {
      vivo = false;
    };
  }, [url, p.itemName]);

  const guardar = useCallback(async () => {
    if (!estado?.puede) return;
    const aviso =
      `¿Guardar "${p.itemName}" en el catálogo?\n\n` +
      `Queda como molde reusable en la categoría ${estado.categoria}` +
      (estado.categoriaEsNueva ? " (categoría nueva, no existía en el catálogo)" : "") +
      `, con su desglose completo de materiales y mano de obra.\n\n` +
      `Solo se CREA el molde. Las demás cotizaciones no se tocan, y esta partida\n` +
      `no cambia de precio: crear un molde no mueve ningún total.`;
    if (!confirm(aviso)) return;

    setGuardando(true);
    try {
      const res = await fetch(url, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // El server manda el motivo en castellano (ej: alguien ya creó ese
        // molde desde otra pestaña mientras el panel estaba abierto).
        alert(data.error || "No se pudo guardar al catálogo");
        setEstado(data.puede === undefined ? estado : (data as Estado));
        return;
      }
      alert(
        `"${data.nombre}" quedó guardada en el catálogo, en ${data.categoria}` +
          (data.pushed ? `, con sus ${data.pushed} líneas de desglose.` : ".") +
          `\n\nSolo se creó el molde. Las demás cotizaciones no se tocaron.`
      );
      p.onSaved(data.catalogPartidaId);
    } catch {
      alert("No se pudo guardar al catálogo");
    } finally {
      setGuardando(false);
    }
  }, [estado, p, url]);

  if (!estado) return null;

  // Ya hay un molde con ese nombre en esa categoría. No se ofrece el botón: se
  // muestra cuál es, para que MJ decida (renombrar la partida, o actualizar el
  // molde desde el propio catálogo).
  if (!estado.puede && estado.motivo === "nombre-repetido") {
    return (
      <div className="flex justify-end">
        <a
          href={`/catalogo/partidas?focus=${estado.moldeId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gray-500 hover:text-gray-900 border border-gray-200 hover:border-gray-400 px-2 py-0.5 rounded-lg transition-colors whitespace-nowrap"
          title={`Ya hay una partida "${estado.moldeNombre}" en la categoría ${estado.categoria} del catálogo. Para no duplicarla, esta no se guarda: cambiale el nombre, o actualizá la del catálogo desde ahí.`}
        >
          Ya está en el catálogo: {estado.moldeNombre} ↗
        </a>
      </div>
    );
  }

  if (!estado.puede && estado.motivo === "sin-capitulo") {
    return (
      <div className="flex justify-end">
        <span className="text-xs text-gray-400">
          Sin capítulo: no se puede guardar al catálogo
        </span>
      </div>
    );
  }

  if (!estado.puede || !p.canEdit) return null;

  return (
    <div className="flex justify-end">
      <button
        onClick={guardar}
        disabled={guardando}
        className="text-xs text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-400 px-2 py-0.5 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
        title={`Crea un molde reusable en el catálogo (categoría ${estado.categoria}) con el desglose completo de esta partida. No toca ninguna otra cotización.`}
      >
        {guardando ? "Guardando…" : "↑ Guardar al catálogo"}
      </button>
    </div>
  );
}
