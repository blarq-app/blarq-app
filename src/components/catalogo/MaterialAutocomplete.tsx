"use client";

import { useEffect, useRef, useState } from "react";

// Autocomplete que busca contra MaterialCatalog mientras MJ escribe.
// Al elegir un resultado: setea description / unit / unitCost (= netPrice)
// y guarda materialId para que después podamos enlazar pérdidas a un
// material concreto de la partida (item 5c).
//
// Si MJ escribe algo que no existe en el catálogo, le ofrecemos un botón
// "+ Crear nuevo" que llama a POST /api/catalogo/materiales y devuelve el
// material recién creado.

type Material = {
  id: string;
  name: string;
  category: string;
  unit: string;
  netPrice: number;
};

export default function MaterialAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
}: {
  value: string;
  onChange: (newValue: string) => void;
  onSelect: (material: Material) => void;
  placeholder?: string;
}) {
  const [results, setResults] = useState<Material[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Buscar con debounce
  useEffect(() => {
    if (!value || value.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/catalogo/materiales?q=${encodeURIComponent(value)}&limit=15`
        );
        if (res.ok) {
          const data = (await res.json()) as Material[];
          setResults(data);
          setHighlight(0);
        }
      } catch {
        /* noop */
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [value]);

  // Click fuera → cerrar
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function handleSelect(m: Material) {
    onSelect(m);
    setOpen(false);
  }

  async function handleCreateNew() {
    const name = value.trim();
    if (!name) return;
    setLoading(true);
    try {
      const res = await fetch("/api/catalogo/materiales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category: "OTROS",
          unit: "UN",
          netPrice: 0,
        }),
      });
      if (res.ok) {
        const m = (await res.json()) as Material;
        handleSelect(m);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Error al crear material");
      }
    } finally {
      setLoading(false);
    }
  }

  // Match exacto = no mostrar el "crear nuevo"
  const exactMatch = results.some(
    (m) => m.name.toUpperCase() === value.trim().toUpperCase()
  );
  const showCreate = !exactMatch && value.trim().length >= 2;

  return (
    <div ref={containerRef} className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open) return;
          const total = results.length + (showCreate ? 1 : 0);
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => (h + 1) % Math.max(total, 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => (h - 1 + total) % Math.max(total, 1));
          } else if (e.key === "Enter") {
            if (highlight < results.length) {
              e.preventDefault();
              handleSelect(results[highlight]);
            } else if (showCreate) {
              e.preventDefault();
              handleCreateNew();
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder ?? "Buscar material…"}
        className="w-full border border-gray-300 rounded px-2 py-1 text-[11px]"
      />
      {open && (results.length > 0 || showCreate || loading) && (
        <div className="absolute z-20 left-0 right-0 mt-0.5 bg-white border border-gray-300 rounded shadow-lg max-h-60 overflow-y-auto text-[11px]">
          {loading && (
            <div className="px-2 py-1 text-gray-400 italic">Buscando…</div>
          )}
          {!loading &&
            results.map((m, i) => (
              <button
                key={m.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(m)}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full text-left px-2.5 py-1.5 flex items-start justify-between gap-3 ${
                  i === highlight ? "bg-gray-100" : "hover:bg-gray-50"
                }`}
              >
                {/* Nombre completo y prominente (puede ocupar 2 líneas si es
                    largo, no se corta). La categoría pasa a ser un subtítulo
                    chico y gris debajo — antes iba antes del nombre y lo
                    empujaba/cortaba. */}
                <span className="min-w-0 flex-1">
                  <span className="block text-gray-900 leading-snug break-words">
                    {m.name}
                  </span>
                  <span className="block text-[9px] uppercase tracking-wide text-gray-400 mt-0.5">
                    {m.category}
                  </span>
                </span>
                <span className="shrink-0 pt-0.5 text-[10px] text-gray-500 tabular-nums whitespace-nowrap">
                  {m.unit} · ${m.netPrice.toLocaleString("es-CL")}
                </span>
              </button>
            ))}
          {!loading && showCreate && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCreateNew}
              onMouseEnter={() => setHighlight(results.length)}
              className={`w-full text-left px-2 py-1 border-t border-gray-200 text-gray-700 ${
                highlight === results.length ? "bg-gray-100" : "hover:bg-gray-50"
              }`}
            >
              + Crear nuevo material{" "}
              <span className="text-gray-500">«{value.trim()}»</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
